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

const CONTAINER = '.QuestionOuter, div[role="group"][id^="QID"]';

function classify(container: Element): QuestionType | null {
  if (container.querySelector('table.Matrix, .Matrix, table.SBSMatrix, .Bipolar')) return 'matrix';
  if (container.querySelector('.horizontalbar, input[type="range"], .Slider, .ResultsInput'))
    return 'likert';
  if (container.querySelector('select')) return 'dropdown';
  if (container.querySelector('input[type="checkbox"], .q-checkbox')) return 'checkbox';
  if (container.querySelector('input[type="radio"], .q-radio')) return 'radio';
  if (container.querySelector('textarea')) return 'textarea';
  if (container.querySelector('input.InputText, input[type="text"]')) return 'text';
  return null;
}

function readMatrix(container: Element): Pick<SurveyQuestion, 'rows' | 'options'> {
  const table = container.querySelector('table.Matrix, .Matrix, table.SBSMatrix, .Bipolar');
  if (!table) return {};

  const theadThs = Array.from(table.querySelectorAll('thead th, thead td'));
  const headerRow = table.querySelector('thead tr, tr:first-child');
  const rawHeaders =
    theadThs.length > 0 ? theadThs : Array.from(headerRow?.querySelectorAll('th, td') ?? []);
  const headerCells = rawHeaders.map((th) => cleanText(th.textContent)).filter(Boolean);

  const rows = Array.from(table.querySelectorAll('tbody tr, tr'))
    .filter((tr) => tr.querySelector('input') && !tr.closest('thead'))
    .map((tr) => ({
      label: cleanText(tr.querySelector('th, td:first-child, .c1, .ylabel')?.textContent),
      elementRefId: stampRef(tr, 'row'),
    }))
    .filter((r) => r.label !== '');

  const firstInputRow = Array.from(table.querySelectorAll('tr')).find(
    (tr) => tr.querySelector('input') && !tr.closest('thead'),
  );
  const inputCount = firstInputRow ? firstInputRow.querySelectorAll('input').length : 0;

  const columns = (
    headerCells.length > inputCount ? headerCells.slice(headerCells.length - inputCount) : headerCells
  ).map((label, i) => ({ label, elementRefId: `col${i}` }));

  return { rows, options: columns.length ? columns : undefined };
}

export const qualtricsAdapter: SurveyAdapter = {
  id: 'qualtrics',
  label: 'Qualtrics',

  detect() {
    return (
      /qualtrics\.com$/.test(location.hostname) ||
      document.querySelector('.QuestionOuter, #Questions') !== null
    );
  },

  scan(): SurveyDOMSchema {
    const title =
      cleanText(document.querySelector('.Title, #Header')?.textContent) || document.title;
    const schema = baseSchema('qualtrics', title);
    const skipped: SurveyDOMSchema['skipped'] = [];
    const questions: SurveyQuestion[] = [];

    Array.from(document.querySelectorAll(CONTAINER)).forEach((container) => {
      const domRef = stampRef(container, 'qx');
      const vis = visibilityReport(container);
      if (!vis.visible) {
        skipped.push({ domRef, reason: vis.reason ?? 'not visible' });
        return;
      }

      const type = classify(container);
      const label = cleanText(
        container.querySelector('.QuestionText, .QuestionBody legend')?.textContent,
      );

      if (!type) {
        skipped.push({ domRef, reason: 'descriptive text block, no input' });
        return;
      }

      const q: SurveyQuestion = {
        id: container.id || hashId(label, type, questions.length),
        index: questions.length,
        label,
        type,
        required: container.querySelector('[aria-required="true"], .ValidationError') !== null,
        domRef,
      };

      if (type === 'matrix') {
        Object.assign(q, readMatrix(container));
      } else if (type === 'radio' || type === 'checkbox') {
        q.options = Array.from(container.querySelectorAll('.ChoiceStructure li, fieldset label'))
          .filter((el) => el.querySelector('input') && visibilityReport(el).visible)
          .map((el) => ({
            label: cleanText(el.textContent),
            elementRefId: stampRef(el.querySelector('input')!, 'opt'),
          }))
          .filter((o) => o.label !== '');
      } else if (type === 'dropdown') {
        const select = container.querySelector('select');
        if (select) {
          stampRef(select, 'in');
          q.options = Array.from(select.options)
            .filter((o) => o.value !== '')
            .map((o, i) => ({ label: cleanText(o.textContent), elementRefId: `idx${i}` }));
        }
      } else if (type === 'likert') {
        const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
        if (slider) {
          stampRef(slider, 'in');
          q.scale = { min: Number(slider.min || 0), max: Number(slider.max || 100) };
        }
      } else {
        const field = container.querySelector('input, textarea');
        if (field) {
          stampRef(field, 'in');
          q.constraints = readConstraints(field);
        }
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
    return document.querySelector<HTMLElement>('#NextButton, [id$="NextButton"]') ?? null;
  },

  findSubmitControl() {
    const next = document.querySelector<HTMLElement>('#NextButton');
    // Qualtrics reuses NextButton on the final page, relabelled.
    if (next && /submit|finish/i.test(cleanText(next.getAttribute('value') ?? next.textContent))) {
      return next;
    }
    return document.querySelector<HTMLElement>('#SubmitButton') ?? null;
  },
};
