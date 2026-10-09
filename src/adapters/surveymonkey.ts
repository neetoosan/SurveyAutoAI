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

const CONTAINER =
  '.question-container, .question-row, div[data-qnumber], .survey-question, div[data-question-id]';
const TITLE = '.question-title, .user-generated, .question-legend, .question-heading';
const SUBTITLE = '.question-subtitle, .question-instruction';

function classify(container: Element): QuestionType | null {
  if (container.querySelector('.matrix-table, table.matrix, table[role="grid"]')) return 'matrix';
  if (container.querySelector('.rating-slider, input[type="range"], .slider-container'))
    return 'likert';
  if (container.querySelector('select')) return 'dropdown';
  if (container.querySelector('input[type="checkbox"]')) return 'checkbox';
  if (container.querySelector('input[type="radio"]')) return 'radio';
  if (container.querySelector('textarea')) return 'textarea';
  if (container.querySelector('input[type="date"]')) return 'date';
  if (container.querySelector('input[type="number"]')) return 'number';
  if (container.querySelector('input[type="text"], input:not([type])')) return 'text';
  return null;
}

function readMatrix(container: Element): Pick<SurveyQuestion, 'rows' | 'options'> {
  const table = container.querySelector('.matrix-table, table.matrix, table[role="grid"]');
  if (!table) return {};

  const theadThs = Array.from(table.querySelectorAll('thead th, thead td'));
  const headerRow = table.querySelector('thead tr, tr:first-child');
  const rawHeaders =
    theadThs.length > 0 ? theadThs : Array.from(headerRow?.querySelectorAll('th, td') ?? []);
  const headerCells = rawHeaders.map((th) => cleanText(th.textContent)).filter(Boolean);

  const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
    .filter((tr) => tr.querySelector('input') && !tr.closest('thead'))
    .map((tr) => ({
      label: cleanText(tr.querySelector('th, td:first-child, .row-label')?.textContent),
      elementRefId: stampRef(tr, 'row'),
    }))
    .filter((r) => r.label !== '');

  // Calculate columns based on inputs in the first row
  const firstInputRow = Array.from(table.querySelectorAll('tr')).find(
    (tr) => tr.querySelector('input') && !tr.closest('thead'),
  );
  const inputCount = firstInputRow ? firstInputRow.querySelectorAll('input').length : 0;

  const columns = (
    headerCells.length > inputCount ? headerCells.slice(headerCells.length - inputCount) : headerCells
  ).map((label, i) => ({
    label,
    elementRefId: `col${i}`,
  }));

  return { rows, options: columns.length ? columns : undefined };
}

function readOptions(container: Element, selector: string): QuestionOption[] {
  return Array.from(container.querySelectorAll(selector))
    .filter((el) => visibilityReport(el).visible)
    .map((el) => {
      const input = el.matches('input') ? el : el.querySelector('input');
      const target = input ?? el;
      const optionContainer = el.closest('.answer-option-cell, .radio-button-label, .checkbox-label, label') ?? el;
      const label =
        cleanText(optionContainer.querySelector('.answer-label, .radio-button-label, .checkbox-label')?.textContent) ||
        cleanText(el.closest('label')?.textContent) ||
        cleanText(el.textContent) ||
        accessibleLabel(target);

      return {
        label,
        elementRefId: stampRef(target, 'opt'),
      };
    })
    .filter((o) => o.label !== '');
}

export const surveymonkeyAdapter: SurveyAdapter = {
  id: 'surveymonkey',
  label: 'SurveyMonkey',

  detect() {
    return (
      /(^|\.)surveymonkey\.(com|co\.uk)$/.test(location.hostname) ||
      document.querySelector('.survey-page, .question-container, #survey-container') !== null
    );
  },

  scan(): SurveyDOMSchema {
    const title =
      cleanText(document.querySelector('.survey-title, .title-text, h1')?.textContent) ||
      document.title;
    const schema = baseSchema('surveymonkey', title);
    const skipped: SurveyDOMSchema['skipped'] = [];
    const questions: SurveyQuestion[] = [];

    Array.from(document.querySelectorAll(CONTAINER)).forEach((container) => {
      const domRef = stampRef(container, 'sm');
      const vis = visibilityReport(container);
      if (!vis.visible) {
        skipped.push({ domRef, reason: vis.reason ?? 'not visible' });
        return;
      }

      const type = classify(container);
      const rawTitle = cleanText(container.querySelector(TITLE)?.textContent);
      const label = stripRequiredMarker(rawTitle);

      if (!type || !label) {
        skipped.push({ domRef, reason: type ? 'no question title' : 'no recognized input' });
        return;
      }

      const required = Boolean(
        container.querySelector('.required-asterisk, span.required, [aria-required="true"]') ||
          rawTitle.endsWith('*'),
      );

      const q: SurveyQuestion = {
        id:
          container.getAttribute('data-question-id') ??
          container.getAttribute('data-qnumber') ??
          (container.id || hashId(label, type, questions.length)),
        index: questions.length,
        label,
        type,
        required,
        domRef,
      };

      const description = cleanText(container.querySelector(SUBTITLE)?.textContent);
      if (description && description !== label) q.description = description;

      if (type === 'matrix') {
        Object.assign(q, readMatrix(container));
      } else if (type === 'radio') {
        q.options = readOptions(container, 'input[type="radio"]');
      } else if (type === 'checkbox') {
        q.options = readOptions(container, 'input[type="checkbox"]');
      } else if (type === 'dropdown') {
        const select = container.querySelector('select');
        if (select) {
          stampRef(select, 'in');
          q.options = Array.from(select.options)
            .filter((o) => o.value !== '' && cleanText(o.textContent).toLowerCase() !== 'select')
            .map((o, i) => ({ label: cleanText(o.textContent), elementRefId: `idx${i}` }));
        }
      } else if (type === 'likert') {
        const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
        if (slider) {
          stampRef(slider, 'in');
          q.scale = { min: Number(slider.min || 1), max: Number(slider.max || 10) };
        } else {
          // SurveyMonkey rating scales with numeric buttons
          q.options = readOptions(container, '.rating-button, .scale-option');
          const values = q.options.map((o) => Number(o.label)).filter(Number.isFinite);
          if (values.length >= 2) {
            q.scale = { min: Math.min(...values), max: Math.max(...values) };
          }
        }
      } else {
        const field = container.querySelector('input, textarea');
        if (field) {
          stampRef(field, 'in');
          q.constraints = readConstraints(field);
          if (!q.label) q.label = accessibleLabel(field);
        }
      }

      questions.push(q);
    });

    return {
      ...schema,
      skipped,
      page: {
        pageIndex: readPageIndex(),
        questions,
        hasNext: Boolean(this.findNextControl()),
        hasSubmit: Boolean(this.findSubmitControl()),
      },
    };
  },

  findNextControl() {
    return (
      document.querySelector<HTMLElement>(
        'button.next-button, button[data-action="next"], .btn.next-button, a.next-button',
      ) ?? null
    );
  },

  findSubmitControl() {
    return (
      document.querySelector<HTMLElement>(
        'button.done-button, button[data-action="submit"], .btn.done-button, button.finish-button',
      ) ?? null
    );
  },
};

function readPageIndex(): number {
  const progress = cleanText(document.querySelector('.progress-text, .page-number')?.textContent);
  const match = progress.match(/page\s*(\d+)/i);
  return match?.[1] ? Number(match[1]) - 1 : 0;
}
