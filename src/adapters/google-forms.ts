import type { QuestionOption, QuestionType, SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import {
  accessibleLabel,
  baseSchema,
  cleanText,
  hashId,
  readConstraints,
  stampRef,
  stripRequiredMarker,
  visibilityReport,
  type SurveyAdapter,
} from './base';

const CONTAINER = 'div[role="listitem"], .geS5n';
const TITLE = '.M7eMe';
const DESCRIPTION = '.gubaDc, .OIC90c';

function classifyContainer(container: Element): QuestionType | null {
  if (container.querySelector('div[role="grid"], .E2D20, .lLfZXe')) return 'matrix';
  if (container.querySelector('div[role="radiogroup"][data-value], .vQES8d')) return 'likert';
  if (container.querySelector('div[role="checkbox"]')) return 'checkbox';
  if (container.querySelector('div[role="listbox"]')) return 'dropdown';
  if (container.querySelector('div[role="radio"]')) return 'radio';
  if (container.querySelector('textarea, textarea.KHxj8b')) return 'textarea';
  if (container.querySelector('input[type="date"]')) return 'date';
  if (container.querySelector('input[type="number"]')) return 'number';
  if (container.querySelector('input[type="text"], input.whsOnd')) return 'text';
  return null;
}

/**
 * Google Forms renders a linear scale as a radiogroup whose options are the
 * numbers themselves, with the anchor captions in sibling label nodes.
 */
function readScale(container: Element): SurveyQuestion['scale'] | undefined {
  const radios = Array.from(container.querySelectorAll('div[role="radio"]'));
  const values = radios
    .map((r) => Number(cleanText(r.getAttribute('data-value') ?? r.getAttribute('aria-label'))))
    .filter((n) => Number.isFinite(n));
  if (values.length < 3) return undefined;
  const labels = Array.from(container.querySelectorAll('.zPZGTe, .YEVVod')).map((n) =>
    cleanText(n.textContent),
  );
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    minLabel: labels[0] || undefined,
    maxLabel: labels.length > 1 ? labels[labels.length - 1] : undefined,
  };
}

function readGrid(container: Element): Pick<SurveyQuestion, 'rows' | 'options'> {
  const grid = container.querySelector('div[role="grid"], .E2D20, .lLfZXe');
  if (!grid) return {};

  const colHeaders = Array.from(grid.querySelectorAll('div[role="columnheader"], .BswIee, .ssXDEe'))
    .map((el) => cleanText(el.textContent))
    .filter(Boolean);

  const rowElements = Array.from(grid.querySelectorAll('div[role="row"]')).filter((row) =>
    row.querySelector('div[role="radio"], div[role="checkbox"]'),
  );

  const rows = rowElements
    .map((row) => ({
      label: cleanText(row.querySelector('div[role="rowheader"], .V4d7Ke')?.textContent),
      elementRefId: stampRef(row, 'row'),
    }))
    .filter((r) => r.label !== '');

  const columns = colHeaders.map((label, i) => ({
    label,
    elementRefId: `col${i}`,
  }));

  return { rows, options: columns.length ? columns : undefined };
}

function readOptions(container: Element, selector: string): QuestionOption[] {
  return Array.from(container.querySelectorAll(selector))
    .filter((el) => visibilityReport(el).visible)
    .map((el) => {
      let label =
        cleanText(el.getAttribute('aria-label') ?? el.getAttribute('data-value')) ||
        cleanText(el.closest('label')?.textContent) ||
        cleanText(el.parentElement?.textContent);

      // Check for Google Forms "Other:" companion text field
      const otherInput = el.closest('label, div[role="presentation"]')?.querySelector<HTMLInputElement>(
        'input.Hvn9fb, input[type="text"]',
      );
      if (otherInput) {
        stampRef(otherInput, 'in');
        if (!label || label.toLowerCase().startsWith('other')) {
          label = label ? `${label} (with text entry)` : 'Other (with text entry)';
        }
      }

      return {
        label,
        elementRefId: stampRef(el, 'opt'),
      };
    })
    .filter((o) => o.label !== '');
}

/** Dropdown options live in a detached listbox until the control is opened. */
function readDropdownOptions(container: Element): QuestionOption[] {
  const listbox = container.querySelector('div[role="listbox"]');
  if (!listbox) return [];
  return (
    Array.from(listbox.querySelectorAll('div[role="option"]'))
      .map((el) => ({
        label: cleanText(el.getAttribute('data-value') ?? el.textContent),
        elementRefId: stampRef(el, 'opt'),
      }))
      // The first entry is the "Choose" placeholder, which carries no data-value.
      .filter((o) => o.label !== '' && o.label.toLowerCase() !== 'choose')
  );
}

export const googleFormsAdapter: SurveyAdapter = {
  id: 'google-forms',
  label: 'Google Forms',

  detect() {
    return (
      (/(^|\.)docs\.google\.com$/.test(location.hostname) && location.pathname.includes('/forms/')) ||
      /(^|\.)forms\.gle$/.test(location.hostname) ||
      document.querySelector('form[action*="docs.google.com/forms"], .freebirdFormviewerViewFormContent') !==
        null
    );
  },

  scan(): SurveyDOMSchema {
    const title =
      cleanText(document.querySelector('.F9yp7e, [role="heading"][aria-level="1"]')?.textContent) ||
      document.title;
    const schema = baseSchema('google-forms', title);
    const skipped: SurveyDOMSchema['skipped'] = [];
    const questions: SurveyQuestion[] = [];

    Array.from(document.querySelectorAll(CONTAINER)).forEach((container) => {
      const vis = visibilityReport(container);
      const label = stripRequiredMarker(cleanText(container.querySelector(TITLE)?.textContent));
      const domRef = stampRef(container, 'gf');

      if (!vis.visible) {
        skipped.push({ domRef, reason: vis.reason ?? 'not visible' });
        return;
      }

      const type = classifyContainer(container);
      if (!type || !label) {
        // Section headers and image-only items land here.
        skipped.push({ domRef, reason: type ? 'no question title' : 'no recognized input' });
        return;
      }

      const required = Boolean(
        container.querySelector('.vnumgf, [aria-label*="Required"]') ||
        container.querySelector('[aria-required="true"]'),
      );

      const q: SurveyQuestion = {
        id:
          container.getAttribute('data-params')?.match(/\[\[(\d+)/)?.[1] ??
          hashId(label, type, questions.length),
        index: questions.length,
        label,
        type,
        required,
        domRef,
      };

      const description = cleanText(container.querySelector(DESCRIPTION)?.textContent);
      if (description && description !== label) q.description = description;

      if (type === 'matrix') {
        Object.assign(q, readGrid(container));
      } else if (type === 'likert') {
        q.scale = readScale(container);
        q.options = readOptions(container, 'div[role="radio"]');
      } else if (type === 'radio') {
        q.options = readOptions(container, 'div[role="radio"]');
      } else if (type === 'checkbox') {
        q.options = readOptions(container, 'div[role="checkbox"]');
      } else if (type === 'dropdown') {
        q.options = readDropdownOptions(container);
      } else {
        const field = container.querySelector('input, textarea');
        if (field) {
          q.constraints = readConstraints(field);
          stampRef(field, 'in');
          if (!q.label) q.label = accessibleLabel(field);
        }
      }

      questions.push(q);
    });

    const next = this.findNextControl();
    const submit = this.findSubmitControl();

    return {
      ...schema,
      skipped,
      page: {
        pageIndex: readPageIndex(),
        questions,
        hasNext: Boolean(next),
        hasSubmit: Boolean(submit),
      },
    };
  },

  findNextControl() {
    return findByLabel(['Next']) ?? null;
  },

  findSubmitControl() {
    return findByLabel(['Submit', 'Send']) ?? null;
  },
};

/** Forms exposes progress as "Page N of M" in the header when paging is on. */
function readPageIndex(): number {
  const text = cleanText(document.querySelector('.vnu2uc, .ArU7Ic')?.textContent);
  const match = text.match(/(\d+)\s*of\s*\d+/i);
  return match?.[1] ? Number(match[1]) - 1 : 0;
}

function findByLabel(labels: string[]): HTMLElement | null {
  const buttons = Array.from(
    document.querySelectorAll<HTMLElement>('div[role="button"], button'),
  ).filter((b) => visibilityReport(b).visible);
  for (const label of labels) {
    const hit = buttons.find((b) => cleanText(b.textContent).toLowerCase() === label.toLowerCase());
    if (hit) return hit;
  }
  return null;
}
