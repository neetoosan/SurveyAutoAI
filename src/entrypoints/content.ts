import type { ContentCommand, ContentResponse, ValidationFinding } from '@/types/messages';
import type { SurveyDOMSchema } from '@/types/survey';
import { pickAdapter, resetRefs } from '@/adapters';
import { collectValidationErrors, fillPage } from '@/dom/fill';
import { clearHighlights, renderHighlights } from '@/dom/highlight';
import { detectCaptcha, setupCaptchaWatcher } from '@/dom/tripwire';
import { simulateHumanClick } from '@/dom/emulation';

export default defineContentScript({
  // No `matches`: the script is never declared against a URL pattern. The
  // background injects it into the active tab on demand under `activeTab`,
  // which keeps <all_urls> out of host_permissions entirely.
  registration: 'runtime',
  main() {
    let lastSchema: SurveyDOMSchema | null = null;

    /** Wait for the page to settle after a navigation before re-reading it. */
    function awaitQuiet(timeoutMs = 2500): Promise<void> {
      return new Promise((resolve) => {
        let timer = setTimeout(done, 600);
        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(done, 400);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        const ceiling = setTimeout(done, timeoutMs);

        function done() {
          clearTimeout(timer);
          clearTimeout(ceiling);
          observer.disconnect();
          resolve();
        }
      });
    }

    function scan(): SurveyDOMSchema {
      resetRefs();
      clearHighlights();
      lastSchema = pickAdapter().scan();
      return lastSchema;
    }

    async function advance(control: 'next' | 'submit'): Promise<{
      advanced: boolean;
      findings: ValidationFinding[];
    }> {
      // Pre-check for CAPTCHA tripwire
      const challenge = detectCaptcha();
      if (challenge) {
        return {
          advanced: false,
          findings: [
            {
              severity: 'error',
              code: 'CAPTCHA_TRIPWIRE',
              message: `Cannot advance: ${challenge.description} is present. Solve it before proceeding.`,
            },
          ],
        };
      }

      const adapter = pickAdapter();
      const target = control === 'next' ? adapter.findNextControl() : adapter.findSubmitControl();

      if (!target) {
        return {
          advanced: false,
          findings: [
            {
              severity: 'error',
              code: control === 'next' ? 'NO_NEXT_CONTROL' : 'NO_SUBMIT_CONTROL',
              message: `Adapter "${adapter.id}" found no ${control} control on this page.`,
            },
          ],
        };
      }

      const before = location.href;
      const beforeFingerprint = document.body.innerText.length;

      // Use human-grade synthetic click sequence
      await simulateHumanClick(target, { speed: 'human' });
      await awaitQuiet();

      // Validation blocking the advance is the interesting outcome here, so
      // the errors are read after the click rather than before.
      const findings = collectValidationErrors();
      const navigated = location.href !== before;
      const contentChanged = document.body.innerText.length !== beforeFingerprint;

      // Error text appearing also changes the fingerprint, so a form that
      // complained has not advanced however much its content moved.
      const advanced = navigated || (findings.length === 0 && contentChanged);

      if (!advanced && findings.length === 0) {
        findings.push({
          severity: 'warning',
          code: 'ADVANCE_NO_EFFECT',
          message: `Clicking ${control} changed nothing and surfaced no validation message.`,
        });
      }

      return { advanced, findings };
    }

    // Set up real-time CAPTCHA tripwire monitor
    setupCaptchaWatcher((challenge) => {
      chrome.runtime
        .sendMessage({
          type: 'TRIPWIRE_TRIGGERED',
          payload: challenge,
        })
        .catch(() => {});
    });

    chrome.runtime.onMessage.addListener(
      (message: ContentCommand | { type: 'PING' }, _sender, sendResponse) => {
        (async (): Promise<ContentResponse> => {
          switch (message.type) {
            case 'PING':
              return { type: 'ACK' };

            case 'SCAN_PAGE':
              return { type: 'SCAN_RESULT', payload: scan() };

            case 'FILL_PAGE': {
              const { answers, schema, dryRun, emulationMode } = message.payload;
              // A dry run only paints the overlay; nothing touches the form.
              if (dryRun) {
                renderHighlights(schema, answers);
              } else {
                clearHighlights();
              }
              const outcome = await fillPage(schema, answers, { dryRun, emulationMode });
              if (!dryRun) {
                await awaitQuiet(1200);
                outcome.findings.push(...collectValidationErrors());
              }
              return { type: 'FILL_RESULT', payload: outcome };
            }

            case 'ADVANCE_PAGE':
              return { type: 'NAVIGATION_RESULT', payload: await advance('next') };

            case 'SUBMIT_PAGE':
              return { type: 'NAVIGATION_RESULT', payload: await advance('submit') };

            case 'PROBE_VALIDATION':
              return {
                type: 'VALIDATION_RESULT',
                payload: { findings: collectValidationErrors() },
              };

            case 'CHECK_TRIPWIRE':
              return {
                type: 'TRIPWIRE_RESULT',
                payload: { challenge: detectCaptcha() },
              };

            case 'CLEAR_HIGHLIGHTS':
              clearHighlights();
              return { type: 'ACK' };

            default:
              return { type: 'ERROR', payload: { message: 'Unknown command.' } };
          }
        })()
          .then(sendResponse)
          .catch((error: unknown) =>
            sendResponse({
              type: 'ERROR',
              payload: { message: error instanceof Error ? error.message : String(error) },
            } satisfies ContentResponse),
          );

        return true;
      },
    );

    // Re-scan when the page swaps content under a stable URL, which is how
    // Typeform and Qualtrics page through a survey.
    let debounce: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      if (!lastSchema) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const fresh = pickAdapter();
        if (fresh.id !== lastSchema?.platform) lastSchema = null;
      }, 800);
    }).observe(document.documentElement, { childList: true, subtree: true });
  },
});
