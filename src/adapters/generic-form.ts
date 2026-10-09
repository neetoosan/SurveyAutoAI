import type { QuestionType, SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import {
  accessibleLabel,
  baseSchema,
  cleanText,
  hashId,
  readConstraints,
  stampRef,
  visibilityReport,
  type SurveyAdapter,
} from './base';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const CONTROL_SELECTOR = 'input, select, textarea';
const IGNORED_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image', 'file', 'password']);

function typeOf(el: Control): QuestionType | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'dropdown';
  switch (el.type) {
    case 'radio':
      return 'radio';
    case 'checkbox':
      return 'checkbox';
    case 'range':
      return 'likert';
    case 'number':
      return 'number';
    case 'date':
    case 'datetime-local':
    case 'month':
    case 'week':
      return 'date';
    case 'text':
    case 'email':
    case 'tel':
    case 'url':
    case 'search':
      return 'text';
    default:
      return null;
  }
}

/** Walk up to the nearest element that reads as one question's container. */
function groupContainer(el: Element): Element {
  return (
    el.closest('fieldset') ??
    el.closest('[role="radiogroup"], [role="group"]') ??
    el.closest('.form-group, .field, .question, li') ??
    el.parentElement ??
    el
  );
}

export const genericFormAdapter: SurveyAdapter = {
  id: 'generic',
  label: 'Generic form',

  detect() {
    return document.querySelector(CONTROL_SELECTOR) !== null;
  },

  scan(): SurveyDOMSchema {
    const title = cleanText(document.querySelector('h1')?.textContent) || cleanText(document.title);
    const schema = baseSchema('generic', title);
    const skipped: SurveyDOMSchema['skipped'] = [];
    const questions: SurveyQuestion[] = [];

    /** Radio/checkbox controls sharing a name are one question, not many. */
    const groups = new Map<string, SurveyQuestion>();

    Array.from(document.querySelectorAll<Control>(CONTROL_SELECTOR)).forEach((el) => {
      if (el instanceof HTMLInputElement && IGNORED_INPUT_TYPES.has(el.type)) return;

      const domRef = stampRef(el, 'gn');
      const vis = visibilityReport(el);
      if (!vis.visible) {
        skipped.push({ domRef, reason: vis.reason ?? 'not visible' });
        return;
      }

      const type = typeOf(el);
      if (!type) {
        skipped.push({
          domRef,
          reason: `unsupported input type: ${(el as HTMLInputElement).type}`,
        });
        return;
      }

      const grouped = type === 'radio' || (type === 'checkbox' && el.name !== '');
      const groupKey = grouped && el.name ? `${type}:${el.name}` : '';

      if (groupKey && groups.has(groupKey)) {
        const q = groups.get(groupKey)!;
        q.options ??= [];
        q.options.push({ label: accessibleLabel(el), elementRefId: domRef });
        return;
      }

      const container = groupContainer(el);
      const label = grouped
        ? cleanText(container.querySelector('legend')?.textContent) || accessibleLabel(container)
        : accessibleLabel(el);

      const q: SurveyQuestion = {
        id: el.id || el.name || hashId(label, type, questions.length),
        index: questions.length,
        label,
        type,
        required: el.required || el.getAttribute('aria-required') === 'true',
        domRef: grouped ? stampRef(container, 'grp') : domRef,
        constraints: readConstraints(el),
      };

      if (grouped) {
        q.options = [{ label: accessibleLabel(el), elementRefId: domRef }];
        groups.set(groupKey, q);
      } else if (el instanceof HTMLSelectElement) {
        q.options = Array.from(el.options)
          .filter((o) => o.value !== '')
          .map((o, i) => ({ label: cleanText(o.textContent), elementRefId: `idx${i}` }));
      } else if (type === 'likert') {
        const input = el as HTMLInputElement;
        q.scale = { min: Number(input.min || 0), max: Number(input.max || 100) };
      }

      questions.push(q);
    });

    return {
      ...schema,
      skipped,
      page: {
        pageIndex: 0,
        questions,
        hasNext: Boolean(this.findNextControl()),
        hasSubmit: Boolean(this.findSubmitControl()),
      },
    };
  },

  findNextControl() {
    return findButton(/^(next|continue|forward)$/i);
  },

  findSubmitControl() {
    return (
      findButton(/^(submit|send|finish|done|complete)$/i) ??
      document.querySelector<HTMLElement>('form button[type="submit"], form input[type="submit"]')
    );
  },
};

function findButton(pattern: RegExp): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button, input[type="submit"], input[type="button"], [role="button"], a.btn',
    ),
  ).filter((el) => visibilityReport(el).visible);

  return (
    candidates.find((el) => {
      const text = cleanText(
        el instanceof HTMLInputElement ? el.value : el.textContent || el.getAttribute('aria-label'),
      );
      return pattern.test(text);
    }) ?? null
  );
}
