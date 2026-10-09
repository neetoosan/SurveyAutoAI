import type {
  BackgroundEvent,
  ContentCommand,
  ContentResponse,
  EmulationSpeed,
  PanelRequest,
  RunSummary,
  SessionState,
  ValidationFinding,
} from '@/types/messages';
import type { SurveyDOMSchema } from '@/types/survey';
import type { PlannedAnswer } from '@/types/respondent';
import type { CaptchaChallenge } from '@/dom/tripwire';
import { planAnswers } from '@/ai/planner';
import { getKey } from '@/storage/vault';
import { downloadRun, getRun, saveRun } from '@/storage/runs';
import {
  resolveRespondent,
  loadCustomPersonas,
  saveCustomPersona,
  deleteCustomPersona,
} from '@/storage/personas';
import { loadSelectedModel, saveSelectedModel, loadCachedModels } from '@/storage/model';
import {
  attestationKeyFor,
  hasHostAccess,
  requireAttestation,
  OwnershipError,
} from '@/ownership/guard';

export default defineBackground(() => {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // Firefox and older Chrome builds have no sidePanel behaviour API.
  });

  let state: SessionState = {
    phase: 'idle',
    ownershipConfirmed: false,
    emulationMode: 'human',
  };
  let tokens = { promptTokens: 0, responseTokens: 0, calls: 0 };

  function emit(event: BackgroundEvent): void {
    // No side panel open is the normal case, not an error.
    chrome.runtime.sendMessage(event).catch(() => {});
  }

  function log(level: 'info' | 'warn' | 'error', message: string): void {
    emit({ type: 'LOG', payload: { level, message, at: Date.now() } });
  }

  function setState(patch: Partial<SessionState>): void {
    state = { ...state, ...patch };
    emit({ type: 'STATE', payload: state });
  }

  function isContentTab(t: chrome.tabs.Tab): boolean {
    return Boolean(t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
  }

  async function activeTab(): Promise<chrome.tabs.Tab> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && isContentTab(tab)) {
      return tab;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const contentTab = tabs.find((t) => isContentTab(t));
    if (contentTab?.id) return contentTab;
    if (!tab?.id) throw new Error('No active tab.');
    return tab;
  }

  /** Content scripts are injected on demand so the extension needs no <all_urls>. */
  async function ensureContentScript(tabId: number): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return;
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
    }
  }

  async function send(command: ContentCommand): Promise<ContentResponse> {
    const tab = await activeTab();
    await ensureContentScript(tab.id!);
    const response = (await chrome.tabs.sendMessage(tab.id!, command)) as ContentResponse;
    if (response.type === 'ERROR') throw new Error(response.payload.message);
    return response;
  }

  async function handleScan(): Promise<SurveyDOMSchema> {
    const tab = await activeTab();
    const key = attestationKeyFor(tab.url ?? '');

    // Both gates: the attestation record, and the origin grant that
    // registration requests. Requiring the record as well means a permission
    // granted directly in chrome://extensions does not bypass registration.
    try {
      await requireAttestation(key);
    } catch (error) {
      setState({ phase: 'error', origin: key, ownershipConfirmed: false });
      throw error;
    }
    if (!(await hasHostAccess(key))) {
      setState({ phase: 'error', origin: key, ownershipConfirmed: false });
      throw new OwnershipError(key);
    }

    setState({ phase: 'scanning' });
    const response = await send({ type: 'SCAN_PAGE' });
    if (response.type !== 'SCAN_RESULT') throw new Error('Unexpected scan response.');

    const schema = response.payload;
    setState({
      phase: 'idle',
      schema,
      tabId: tab.id,
      origin: attestationKeyFor(schema.url),
      ownershipConfirmed: true,
    });

    log(
      'info',
      `${schema.platform}: ${schema.page.questions.length} question(s), ` +
        `${schema.skipped.length} element(s) skipped.`,
    );
    return schema;
  }

  async function handlePlan(schema: SurveyDOMSchema, respondentId: string) {
    const apiKey = await getKey();
    if (!apiKey) throw new Error('API key is locked. Unlock it in the side panel.');

    const model = await loadSelectedModel();
    setState({ phase: 'planning' });
    const respondent = await resolveRespondent(respondentId);
    const result = await planAnswers({
      apiKey,
      model,
      schema,
      respondent,
      memory: currentMemory(),
    });

    tokens = {
      promptTokens: tokens.promptTokens + result.usage.promptTokens,
      responseTokens: tokens.responseTokens + result.usage.responseTokens,
      calls: tokens.calls + result.calls,
    };
    emit({ type: 'TOKENS', payload: tokens });

    const run: RunSummary = state.run ?? {
      runId: `run-${Date.now().toString(36)}`,
      respondent,
      schema,
      answers: [],
      findings: [],
      startedAt: Date.now(),
      submitted: false,
    };

    setState({ phase: 'awaiting-approval', plan: result.answers, run });
    log('info', `Planned ${result.answers.length} answer(s) in ${result.calls} call(s).`);
    return result.answers;
  }

  function currentMemory() {
    return state.run?.answers ?? [];
  }

  async function handleFill(
    schema: SurveyDOMSchema,
    answers: PlannedAnswer[],
    dryRun: boolean,
    emulationMode?: EmulationSpeed,
  ) {
    await requireAttestation(attestationKeyFor(schema.url));

    // Prefer the caller's answers; fall back to the stored plan so the panel
    // can re-fill without re-planning.
    const plan = answers.length ? answers : (state.plan ?? []);
    const mode = emulationMode ?? state.emulationMode ?? 'human';

    setState({ phase: 'filling' });
    const response = await send({
      type: 'FILL_PAGE',
      payload: { answers: plan, schema, dryRun, emulationMode: mode },
    });
    if (response.type !== 'FILL_RESULT') throw new Error('Unexpected fill response.');

    const { records, findings } = response.payload;
    const run = state.run;
    if (run) {
      run.answers.push(...records);
      run.findings.push(...findings);
      await saveRun(run);
    }

    report(findings);

    const hasTripwire = findings.some((f) => f.code === 'CAPTCHA_TRIPWIRE');
    if (hasTripwire) {
      setState({ phase: 'paused', run });
    } else {
      setState({ phase: 'idle', run });
    }

    return response.payload;
  }

  function report(findings: ValidationFinding[]): void {
    for (const finding of findings) {
      const level =
        finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warn' : 'info';
      log(level, `[${finding.code}] ${finding.message}`);
    }
  }

  async function handleAdvance() {
    setState({ phase: 'navigating' });
    const response = await send({ type: 'ADVANCE_PAGE' });
    if (response.type !== 'NAVIGATION_RESULT') throw new Error('Unexpected navigation response.');

    report(response.payload.findings);
    if (state.run) {
      state.run.findings.push(...response.payload.findings);
      await saveRun(state.run);
    }

    const hasTripwire = response.payload.findings.some((f) => f.code === 'CAPTCHA_TRIPWIRE');
    if (hasTripwire) {
      setState({ phase: 'paused' });
    } else {
      setState({ phase: 'idle' });
    }

    return response.payload;
  }

  /**
   * Submit is gated twice: the origin must be attested, and the panel must
   * echo back a token issued for this specific run. That makes an accidental
   * submit against a live form a deliberate act rather than a stray click.
   */
  let pendingSubmitToken: string | null = null;

  function issueSubmitToken(): string {
    pendingSubmitToken = crypto.randomUUID();
    return pendingSubmitToken;
  }

  async function handleSubmit(confirmToken: string) {
    if (!state.schema) throw new Error('Nothing scanned yet.');
    await requireAttestation(attestationKeyFor(state.schema.url));
    if (!pendingSubmitToken || confirmToken !== pendingSubmitToken) {
      throw new Error('Submit confirmation token missing or stale.');
    }
    pendingSubmitToken = null;

    const response = await send({ type: 'SUBMIT_PAGE' });
    if (response.type !== 'NAVIGATION_RESULT') throw new Error('Unexpected submit response.');

    report(response.payload.findings);
    if (state.run) {
      state.run.submitted = true;
      state.run.finishedAt = Date.now();
      state.run.findings.push(...response.payload.findings);
      await saveRun(state.run);
    }

    const hasTripwire = response.payload.findings.some((f) => f.code === 'CAPTCHA_TRIPWIRE');
    if (hasTripwire) {
      setState({ phase: 'paused' });
    } else {
      setState({ phase: 'complete' });
      log('info', 'Submitted.');
    }

    return response.payload;
  }

  let speedrunActive = false;

  function stopSpeedrun(): void {
    if (speedrunActive) {
      speedrunActive = false;
      log('info', 'Autonomous Speedrun stopped by operator.');
      setState({ phase: 'idle' });
    }
  }

  async function handleSpeedrun(respondentId: string, autoSubmit = false): Promise<void> {
    speedrunActive = true;
    setState({ phase: 'speedrun' });
    log('info', `🚀 Autonomous Speedrun initiated with persona "${respondentId}".`);

    let pagesTraversed = 0;
    const MAX_PAGES = 15;

    try {
      while (speedrunActive && pagesTraversed < MAX_PAGES) {
        const tab = await activeTab();
        const key = attestationKeyFor(tab.url ?? '');
        await requireAttestation(key);

        const tripCheck = await send({ type: 'CHECK_TRIPWIRE' });
        if (tripCheck.type === 'TRIPWIRE_RESULT' && tripCheck.payload.challenge) {
          speedrunActive = false;
          setState({ phase: 'paused', tripwire: tripCheck.payload.challenge });
          log('warn', `⚠️ Safety Tripwire hit during speedrun: ${tripCheck.payload.challenge.description}`);
          break;
        }

        log('info', `[Speedrun Page ${pagesTraversed + 1}] Scanning questions...`);
        const schema = await handleScan();

        if (schema.page.questions.length === 0) {
          log('info', 'No questions found on current page.');
          if (schema.page.hasSubmit && autoSubmit) {
            const token = issueSubmitToken();
            await handleSubmit(token);
            log('info', '🎉 Form submitted via Speedrun.');
          }
          break;
        }

        log('info', `[Speedrun Page ${pagesTraversed + 1}] Planning answers with persona...`);
        const plannedAnswers = await handlePlan(schema, respondentId);
        if (!speedrunActive) break;

        log('info', `[Speedrun Page ${pagesTraversed + 1}] Filling ${plannedAnswers.length} question(s)...`);
        const fillResult = await handleFill(schema, plannedAnswers, false);
        const hasError = fillResult.findings.some((f) => f.severity === 'error');
        if (hasError) {
          log('warn', 'Validation error encountered during speedrun fill. Pausing speedrun for inspection.');
          speedrunActive = false;
          setState({ phase: 'idle' });
          break;
        }

        pagesTraversed++;

        if (schema.page.hasNext) {
          log('info', `[Speedrun Page ${pagesTraversed}] Advancing to next page...`);
          await handleAdvance();
          await new Promise((r) => setTimeout(r, 1200));
        } else if (schema.page.hasSubmit) {
          if (autoSubmit) {
            log('info', 'Final submit page reached. Submitting form...');
            const token = issueSubmitToken();
            await handleSubmit(token);
            log('info', '🎉 Form submitted successfully via Autonomous Speedrun!');
          } else {
            log('info', 'Final submit page reached. Awaiting operator confirmation to submit.');
            setState({ phase: 'awaiting-approval' });
          }
          break;
        } else {
          log('info', 'No next or submit button detected. Survey flow finished.');
          break;
        }
      }

      if (pagesTraversed >= MAX_PAGES) {
        log('warn', `Speedrun reached maximum page safety limit (${MAX_PAGES} pages). Stopped.`);
      }
    } catch (err) {
      speedrunActive = false;
      throw err;
    } finally {
      speedrunActive = false;
      if (state.phase === 'speedrun') {
        setState({ phase: 'idle' });
      }
    }
  }

  chrome.runtime.onMessage.addListener(
    (
      message:
        | PanelRequest
        | { type: 'ISSUE_SUBMIT_TOKEN' }
        | { type: 'GET_ACTIVE_TAB_REQUEST' }
        | { type: 'TRIPWIRE_TRIGGERED'; payload: CaptchaChallenge },
      _sender,
      sendResponse,
    ) => {
      (async () => {
        try {
          switch (message.type) {
            case 'TRIPWIRE_TRIGGERED': {
              const challenge = message.payload;
              log('warn', `⚠️ Safety Tripwire: ${challenge.description} detected! Pausing session.`);
              setState({ phase: 'paused', tripwire: challenge });
              emit({ type: 'TRIPWIRE', payload: challenge });
              return sendResponse({ ok: true });
            }

            case 'SCAN_PAGE_REQUEST':
              return sendResponse({ ok: true, data: await handleScan() });

            case 'PLAN_ANSWERS_REQUEST':
              return sendResponse({
                ok: true,
                data: await handlePlan(message.payload.schema, message.payload.respondentId),
              });

            case 'FILL_PAGE_REQUEST':
              return sendResponse({
                ok: true,
                data: await handleFill(
                  message.payload.schema,
                  message.payload.answers,
                  message.payload.dryRun,
                  message.payload.emulationMode,
                ),
              });

            case 'ADVANCE_PAGE_REQUEST':
              return sendResponse({ ok: true, data: await handleAdvance() });

            case 'ISSUE_SUBMIT_TOKEN':
              return sendResponse({ ok: true, data: issueSubmitToken() });

            case 'SUBMIT_REQUEST':
              return sendResponse({
                ok: true,
                data: await handleSubmit(message.payload.confirmToken),
              });

            case 'CLEAR_HIGHLIGHTS_REQUEST':
              await send({ type: 'CLEAR_HIGHLIGHTS' });
              return sendResponse({ ok: true });

            case 'GET_STATE_REQUEST':
              return sendResponse({ ok: true, data: { state, tokens } });

            case 'GET_ACTIVE_TAB_REQUEST': {
              const tab = await activeTab();
              const key = attestationKeyFor(tab.url ?? '');
              return sendResponse({
                ok: true,
                data: { url: tab.url, title: tab.title, key, granted: await hasHostAccess(key) },
              });
            }

            case 'EXPORT_RUN_REQUEST': {
              const run = await getRun(message.payload.runId);
              if (!run) throw new Error(`Run ${message.payload.runId} not found.`);
              await downloadRun(run, message.payload.format);
              return sendResponse({ ok: true });
            }

            case 'SET_EMULATION_MODE_REQUEST': {
              setState({ emulationMode: message.payload.mode });
              log('info', `Emulation mode set to ${message.payload.mode}.`);
              return sendResponse({ ok: true });
            }

            case 'CHECK_TRIPWIRE_REQUEST': {
              const response = await send({ type: 'CHECK_TRIPWIRE' });
              if (response.type === 'TRIPWIRE_RESULT') {
                if (response.payload.challenge) {
                  setState({ phase: 'paused', tripwire: response.payload.challenge });
                } else if (state.phase === 'paused') {
                  setState({ phase: 'idle', tripwire: undefined });
                }
                return sendResponse({ ok: true, data: response.payload });
              }
              return sendResponse({ ok: false, error: 'Failed to check tripwires.' });
            }

            case 'RESUME_REQUEST': {
              const response = await send({ type: 'CHECK_TRIPWIRE' });
              if (response.type === 'TRIPWIRE_RESULT' && response.payload.challenge) {
                log('warn', `Challenge still present: ${response.payload.challenge.description}`);
                return sendResponse({
                  ok: false,
                  error: `Challenge is still active: ${response.payload.challenge.description}`,
                });
              }
              log('info', 'Challenge resolved. Resuming session.');
              setState({ phase: 'idle', tripwire: undefined });
              return sendResponse({ ok: true });
            }

            case 'START_SPEEDRUN_REQUEST':
              handleSpeedrun(message.payload.respondentId, message.payload.autoSubmit).catch(
                (err) => {
                  const detail = err instanceof Error ? err.message : String(err);
                  log('error', `Speedrun error: ${detail}`);
                  setState({ phase: 'error', lastError: detail });
                },
              );
              return sendResponse({ ok: true });

            case 'STOP_SPEEDRUN_REQUEST':
              stopSpeedrun();
              return sendResponse({ ok: true });

            case 'LIST_PERSONAS_REQUEST':
              return sendResponse({ ok: true, data: await loadCustomPersonas() });

            case 'SAVE_PERSONA_REQUEST':
              await saveCustomPersona(message.payload.persona);
              log('info', `Saved custom persona "${message.payload.persona.name}".`);
              return sendResponse({ ok: true });

            case 'DELETE_PERSONA_REQUEST':
              await deleteCustomPersona(message.payload.id);
              log('info', `Deleted custom persona ${message.payload.id}.`);
              return sendResponse({ ok: true });

            case 'UPDATE_PLANNED_ANSWER_REQUEST': {
              const updated = message.payload.answer;
              if (state.plan) {
                const idx = state.plan.findIndex((a) => a.questionId === updated.questionId);
                if (idx >= 0) {
                  state.plan[idx] = updated;
                  setState({ plan: [...state.plan] });
                }
              }
              return sendResponse({ ok: true });
            }

            case 'GET_SELECTED_MODEL_REQUEST': {
              const model = await loadSelectedModel();
              const cached = await loadCachedModels();
              return sendResponse({ ok: true, data: { model, cached } });
            }

            case 'SET_SELECTED_MODEL_REQUEST': {
              await saveSelectedModel(message.payload.model);
              log('info', `Active AI model set to "${message.payload.model}".`);
              return sendResponse({ ok: true });
            }

            default:
              return sendResponse({ ok: false, error: 'Unknown request.' });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (error instanceof OwnershipError) {
            setState({ phase: 'error', ownershipConfirmed: false, lastError: detail });
          } else {
            setState({ phase: 'error', lastError: detail });
          }
          log('error', detail);
          sendResponse({ ok: false, error: detail });
        }
      })();

      // Keeps the message channel open for the async handler above.
      return true;
    },
  );
});
