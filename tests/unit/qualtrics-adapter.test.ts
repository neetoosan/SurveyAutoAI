import { beforeEach, describe, expect, it } from 'vitest';
import { qualtricsAdapter } from '@/adapters/qualtrics';
import { loadQualtrics } from './helpers';

describe('qualtricsAdapter', () => {
  beforeEach(loadQualtrics);

  it('detects Qualtrics document structure', () => {
    expect(qualtricsAdapter.detect()).toBe(true);
  });

  it('scans page title and all question containers', () => {
    const schema = qualtricsAdapter.scan();
    expect(schema.platform).toBe('qualtrics');
    expect(schema.title).toContain('Cloud Architecture Research');
    expect(schema.page.questions).toHaveLength(4);
  });

  it('parses single-choice radio question in ChoiceStructure', () => {
    const schema = qualtricsAdapter.scan();
    const q1 = schema.page.questions.find((q) => q.id === 'QID1');

    expect(q1).toBeDefined();
    expect(q1!.type).toBe('radio');
    expect(q1!.label).toContain('Primary Cloud Provider');
    expect(q1!.options?.map((o) => o.label)).toEqual(['AWS', 'Google Cloud', 'Azure']);
  });

  it('parses matrix table question with rows and columns', () => {
    const schema = qualtricsAdapter.scan();
    const q2 = schema.page.questions.find((q) => q.id === 'QID2');

    expect(q2).toBeDefined();
    expect(q2!.type).toBe('matrix');
    expect(q2!.rows?.map((r) => r.label)).toEqual(['Performance', 'Reliability']);
    expect(q2!.options?.map((c) => c.label)).toEqual(['Poor', 'Fair', 'Excellent']);
  });

  it('parses slider question into likert with min and max bounds', () => {
    const schema = qualtricsAdapter.scan();
    const q3 = schema.page.questions.find((q) => q.id === 'QID3');

    expect(q3).toBeDefined();
    expect(q3!.type).toBe('likert');
    expect(q3!.scale).toEqual({ min: 0, max: 10 });
  });

  it('parses open-ended text entry question', () => {
    const schema = qualtricsAdapter.scan();
    const q4 = schema.page.questions.find((q) => q.id === 'QID4');

    expect(q4).toBeDefined();
    expect(q4!.type).toBe('textarea');
  });

  it('identifies next navigation button', () => {
    const schema = qualtricsAdapter.scan();
    expect(schema.page.hasNext).toBe(true);
  });
});
