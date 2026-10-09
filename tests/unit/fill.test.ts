import { beforeEach, describe, expect, it } from 'vitest';
import { genericFormAdapter } from '@/adapters/generic-form';
import { fillPage } from '@/dom/fill';
import type { PlannedAnswer } from '@/types/respondent';
import type { SurveyDOMSchema } from '@/types/survey';
import { loadMockSurvey } from './helpers';

function questionId(schema: SurveyDOMSchema, match: string): string {
  const q = schema.page.questions.find(
    (question) => question.label.includes(match) || question.id === match,
  );
  if (!q) throw new Error(`fixture has no question matching "${match}"`);
  return q.id;
}

describe('fillPage', () => {
  let schema: SurveyDOMSchema;

  beforeEach(() => {
    loadMockSurvey();
    schema = genericFormAdapter.scan();
  });

  it('writes text into an input and fires input plus change', async () => {
    const events: string[] = [];
    const input = document.getElementById('full-name') as HTMLInputElement;
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    const answers: PlannedAnswer[] = [
      {
        questionId: questionId(schema, 'full-name'),
        textAnswer: 'Ada Lovelace',
        rationale: 'baseline',
      },
    ];

    const outcome = await fillPage(schema, answers, { dryRun: false, emulationMode: 'instant' });

    expect(input.value).toBe('Ada Lovelace');
    expect(events).toContain('input');
    expect(events).toContain('change');
    expect(outcome.records[0]!.error).toBeUndefined();
  });

  it('checks the selected radio option', async () => {
    const answers: PlannedAnswer[] = [
      {
        questionId: questionId(schema, 'own a car'),
        selectedOptionIndex: 1,
        rationale: 'no car path',
      },
    ];

    await fillPage(schema, answers, { dryRun: false, emulationMode: 'instant' });

    const chosen = document.querySelector<HTMLInputElement>('[name="owns_car"]:checked');
    expect(chosen?.value).toBe('no');
  });

  it('checks every selected checkbox option', async () => {
    const answers: PlannedAnswer[] = [
      {
        questionId: questionId(schema, 'Which tools'),
        selectedOptionIndexes: [0, 2],
        rationale: 'two tools',
      },
    ];

    await fillPage(schema, answers, { dryRun: false, emulationMode: 'instant' });

    const checked = Array.from(
      document.querySelectorAll<HTMLInputElement>('[name="tools"]:checked'),
    ).map((el) => el.value);
    expect(checked).toEqual(['git', 'k8s']);
  });

  it('clamps nothing but reports a required question left unanswered', async () => {
    const outcome = await fillPage(schema, [], { dryRun: false, emulationMode: 'instant' });
    const codes = outcome.findings.map((f) => f.code);

    expect(codes).toContain('REQUIRED_UNANSWERED');
    expect(outcome.findings.filter((f) => f.code === 'REQUIRED_UNANSWERED').length).toBeGreaterThan(
      0,
    );
  });

  it('a dry run changes nothing on the page', async () => {
    const input = document.getElementById('full-name') as HTMLInputElement;
    const answers: PlannedAnswer[] = [
      {
        questionId: questionId(schema, 'full-name'),
        textAnswer: 'Should not appear',
        rationale: 'preview',
      },
    ];

    const outcome = await fillPage(schema, answers, { dryRun: true, emulationMode: 'instant' });

    expect(input.value).toBe('');
    expect(outcome.records).toHaveLength(1);
  });

  it('reports an answer for an unknown question instead of throwing', async () => {
    const outcome = await fillPage(
      schema,
      [{ questionId: 'does-not-exist', textAnswer: 'x', rationale: 'hallucinated' }],
      { dryRun: false, emulationMode: 'instant' },
    );

    expect(outcome.findings.some((f) => f.code === 'ORPHAN_ANSWER')).toBe(true);
  });

  it('surfaces the planner uncertainty flag as a finding', async () => {
    const outcome = await fillPage(
      schema,
      [
        {
          questionId: questionId(schema, 'full-name'),
          textAnswer: 'Ada',
          rationale: 'ambiguous prompt',
          uncertain: true,
        },
      ],
      { dryRun: false, emulationMode: 'instant' },
    );

    expect(outcome.findings.some((f) => f.code === 'PLANNER_UNCERTAIN')).toBe(true);
  });

  it('records a fill error when the target element has gone away', async () => {
    document.getElementById('full-name')!.remove();

    const outcome = await fillPage(
      schema,
      [{ questionId: questionId(schema, 'full-name'), textAnswer: 'Ada', rationale: 'stale ref' }],
      { dryRun: false, emulationMode: 'instant' },
    );

    expect(outcome.records[0]!.error).toBeTruthy();
    expect(outcome.findings.some((f) => f.code === 'FILL_FAILED')).toBe(true);
  });
});
