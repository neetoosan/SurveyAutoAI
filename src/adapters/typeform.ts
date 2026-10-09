import type { QuestionType, SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import {
  baseSchema,
  cleanText,
  hashId,
  readConstraints,
  stampRef,
  visibilityReport,
  type SurveyAdapter,
} from './base';

/**
 * Typeform shows one block at a time. A scan therefore returns a single-question
 * page and the harness drives it block by block, which is also the only way to
 * observe its conditional branching.
 */
const BLOCK = 'div[data-qa="block-wrapper"], div[data-qa^="block-"]';

function classifyBlock(block: Element): QuestionType | null {
  if (block.querySelector('textarea')) return 'textarea';
  if (block.querySelector('div[data-qa="opinion-scale"], [data-qa^="rating-"]')) return 'likert';
  if (block.querySelector('input[type="checkbox"]')) return 'checkbox';
  if (
    block.querySelector(
      'input[type="radio"], [data-qa="multiple-choice-option"], [data-qa="picture-choice-option"]',
    )
  )
    return 'radio';
  if (block.querySelector('select, [data-qa="dropdown"]')) return 'dropdown';
  if (block.querySelector('input[type="date"]')) return 'date';
  if (block.querySelector('input[type="number"], input[inputmode="numeric"]')) return 'number';
  if (block.querySelector('input')) return 'text';
  return null;
}

function activeBlock(): Element | null {
  const blocks = Array.from(document.querySelectorAll(BLOCK));
  // The live block is the visible one; Typeform keeps neighbours mounted but hidden.
  return blocks.find((b) => visibilityReport(b).visible) ?? null;
}

/** Simulate pressing Enter to advance active Typeform block. */
export function simulateTypeformEnter(): void {
  const active = activeBlock() ?? document.body;
  const eventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
  active.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  active.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  active.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}

export const typeformAdapter: SurveyAdapter = {
  id: 'typeform',
  label: 'Typeform',

  detect() {
    return (
      /(^|\.)typeform\.com$/.test(location.hostname) ||
      document.querySelector('div[data-qa="block-wrapper"], div[data-qa="welcome-screen"]') !== null
    );
  },

  scan(): SurveyDOMSchema {
    const schema = baseSchema('typeform', cleanText(document.title));
    const skipped: SurveyDOMSchema['skipped'] = [];
    const questions: SurveyQuestion[] = [];
    const block = activeBlock();

    if (block) {
      const domRef = stampRef(block, 'tf');
      const type = classifyBlock(block);
      const label =
        cleanText(block.querySelector('h1, [data-qa="question-title"]')?.textContent) ||
        cleanText(block.querySelector('[class*="Title"], [data-qa="header-title"]')?.textContent);

      if (!type) {
        skipped.push({ domRef, reason: 'statement, welcome, or ending block with no input' });
      } else {
        const q: SurveyQuestion = {
          id: block.getAttribute('data-qa-blockref') ?? hashId(label, type, location.href),
          index: 0,
          label,
          type,
          required: block.querySelector('[required], [aria-required="true"]') !== null,
          domRef,
        };

        const description = cleanText(
          block.querySelector('[data-qa="question-description"], [data-qa="subtitle"]')?.textContent,
        );
        if (description) q.description = description;

        if (type === 'radio' || type === 'checkbox') {
          q.options = Array.from(
            block.querySelectorAll(
              '[data-qa="multiple-choice-option"], [data-qa="picture-choice-option"], label:has(input)',
            ),
          )
            .filter((el) => visibilityReport(el).visible)
            .map((el) => {
              // In Typeform, choices often display a key letter badge (e.g. "A", "B", "C")
              const keyLetter = cleanText(
                el.querySelector('[data-qa="key-sub-letter"], [data-qa="key-badge"]')?.textContent,
              );
              let optionText = cleanText(
                el.querySelector('[data-qa="choice-label"], .text')?.textContent ?? el.textContent,
              );
              if (keyLetter && new RegExp(`^${keyLetter}[\\.\\s\\-:]+`, 'i').test(optionText)) {
                optionText = cleanText(optionText.replace(new RegExp(`^${keyLetter}[\\.\\s\\-:]+`, 'i'), ''));
              }
              const displayLabel = keyLetter ? `${keyLetter}. ${optionText}` : optionText;

              return {
                label: displayLabel || optionText,
                elementRefId: stampRef(el, 'opt'),
              };
            })
            .filter((o) => o.label !== '');
        } else if (type === 'likert') {
          const buttons = Array.from(
            block.querySelectorAll('[data-qa="opinion-scale"] button, [data-qa^="rating-"] button'),
          ).filter((el) => visibilityReport(el).visible);
          q.options = buttons.map((el) => ({
            label: cleanText(el.textContent) || cleanText(el.getAttribute('aria-label')),
            elementRefId: stampRef(el, 'opt'),
          }));
          const values = q.options.map((o) => Number(o.label)).filter(Number.isFinite);
          if (values.length >= 2) {
            q.scale = { min: Math.min(...values), max: Math.max(...values) };
          }
        } else {
          const field = block.querySelector('input, textarea, select');
          if (field) {
            stampRef(field, 'in');
            q.constraints = readConstraints(field);
          }
        }

        questions.push(q);
      }
    }

    return {
      ...schema,
      skipped,
      page: {
        pageIndex: readProgress(),
        questions,
        hasNext: Boolean(this.findNextControl()),
        hasSubmit: Boolean(this.findSubmitControl()),
      },
    };
  },

  findNextControl() {
    return (
      document.querySelector<HTMLElement>(
        '[data-qa="ok-button"], button[data-qa="ok-button"], button[data-qa="continue-button"], button[data-qa^="next"]',
      ) ?? null
    );
  },

  findSubmitControl() {
    return (
      document.querySelector<HTMLElement>(
        'button[data-qa="submit-button"], button[data-qa="submit-button-deep"]',
      ) ?? null
    );
  },
};

/** Typeform exposes completion percentage rather than a page number. */
function readProgress(): number {
  const bar = document.querySelector('[role="progressbar"]');
  const now = Number(bar?.getAttribute('aria-valuenow'));
  return Number.isFinite(now) ? now : 0;
}
