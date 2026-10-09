import { describe, expect, it } from 'vitest';
import { attestationKeyFor, normalizeOrigin } from '@/ownership/guard';
import { runToCsv } from '@/storage/runs';
import type { RunSummary } from '@/types/messages';

describe('attestationKeyFor', () => {
  it('keeps the form path on shared-origin platforms', () => {
    expect(attestationKeyFor('https://docs.google.com/forms/d/e/1FAIpQ/viewform?usp=sf_link')).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQ',
    );
  });

  it('normalizes the two Google Forms entry points to the same key', () => {
    const viewform = attestationKeyFor('https://docs.google.com/forms/d/e/1FAIpQ/viewform');
    const response = attestationKeyFor('https://docs.google.com/forms/d/e/1FAIpQ/formResponse');
    expect(viewform).toBe(response);
  });

  it('scopes a self-hosted form to its origin', () => {
    expect(attestationKeyFor('https://surveys.example.com/q/42?ref=email')).toBe(
      'https://surveys.example.com',
    );
  });

  it('leaves an unparseable value untouched rather than throwing', () => {
    expect(attestationKeyFor('not a url')).toBe('not a url');
    expect(normalizeOrigin('not a url')).toBe('not a url');
  });
});

describe('runToCsv', () => {
  const run: RunSummary = {
    runId: 'run-1',
    respondent: { id: 'happy-path-1', name: 'Happy path', intent: 'baseline', traits: {} },
    schema: {
      platform: 'generic',
      title: 'Mock Survey',
      url: 'https://example.test/form',
      origin: 'https://example.test',
      page: { pageIndex: 0, questions: [], hasNext: false, hasSubmit: true },
      skipped: [],
      scannedAt: 0,
    },
    answers: [
      {
        questionId: 'q1',
        questionLabel: 'Your name, please',
        questionType: 'text',
        value: { textAnswer: 'Ada "A" Lovelace' },
        rationale: 'baseline, contains a comma and quotes',
        filledAt: 0,
      },
      {
        questionId: 'q2',
        questionLabel: 'Tools',
        questionType: 'checkbox',
        value: { selectedOptionIndexes: [0, 2] },
        filledAt: 0,
      },
    ],
    findings: [],
    startedAt: 0,
    submitted: false,
  };

  it('quotes fields containing commas or quotes', () => {
    const csv = runToCsv(run);
    expect(csv).toContain('"Ada ""A"" Lovelace"');
    expect(csv).toContain('"baseline, contains a comma and quotes"');
  });

  it('emits one header row plus one row per answer', () => {
    const lines = runToCsv(run).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('question_id');
  });

  it('joins multi-select answers with a pipe', () => {
    expect(runToCsv(run)).toContain('0|2');
  });
});
