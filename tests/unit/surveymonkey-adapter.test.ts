import { beforeEach, describe, expect, it } from 'vitest';
import { surveymonkeyAdapter } from '@/adapters/surveymonkey';
import { loadSurveyMonkey } from './helpers';

describe('surveymonkeyAdapter', () => {
  beforeEach(loadSurveyMonkey);

  it('detects SurveyMonkey survey structure', () => {
    expect(surveymonkeyAdapter.detect()).toBe(true);
  });

  it('scans survey title and page progress', () => {
    const schema = surveymonkeyAdapter.scan();
    expect(schema.platform).toBe('surveymonkey');
    expect(schema.title).toContain('Customer Experience');
    expect(schema.page.pageIndex).toBe(0);
    expect(schema.page.questions).toHaveLength(5);
  });

  it('parses single-choice radio question with required marker', () => {
    const schema = surveymonkeyAdapter.scan();
    const q1 = schema.page.questions.find((q) => q.id === 'q_freq');

    expect(q1).toBeDefined();
    expect(q1!.type).toBe('radio');
    expect(q1!.required).toBe(true);
    expect(q1!.label).toContain('How often do you shop with us?');
    expect(q1!.description).toContain('Select the most accurate frequency');
    expect(q1!.options?.map((o) => o.label)).toEqual(['Daily', 'Weekly', 'Monthly']);
  });

  it('parses multiple-choice checkbox question', () => {
    const schema = surveymonkeyAdapter.scan();
    const q2 = schema.page.questions.find((q) => q.id === 'q_categories');

    expect(q2).toBeDefined();
    expect(q2!.type).toBe('checkbox');
    expect(q2!.options?.map((o) => o.label)).toEqual(['Electronics', 'Books', 'Clothing']);
  });

  it('parses dropdown question and ignores placeholder', () => {
    const schema = surveymonkeyAdapter.scan();
    const q3 = schema.page.questions.find((q) => q.id === 'q_country');

    expect(q3).toBeDefined();
    expect(q3!.type).toBe('dropdown');
    expect(q3!.options?.map((o) => o.label)).toEqual(['United States', 'United Kingdom', 'Canada']);
  });

  it('parses matrix table question with rows and columns', () => {
    const schema = surveymonkeyAdapter.scan();
    const q4 = schema.page.questions.find((q) => q.id === 'q_service_ratings');

    expect(q4).toBeDefined();
    expect(q4!.type).toBe('matrix');
    expect(q4!.rows?.map((r) => r.label)).toEqual(['Delivery Speed', 'Customer Support']);
    expect(q4!.options?.map((c) => c.label)).toEqual(['Poor', 'Neutral', 'Good']);
  });

  it('parses open-ended textarea question', () => {
    const schema = surveymonkeyAdapter.scan();
    const q5 = schema.page.questions.find((q) => q.id === 'q_feedback');

    expect(q5).toBeDefined();
    expect(q5!.type).toBe('textarea');
  });

  it('identifies next and done navigation buttons', () => {
    const schema = surveymonkeyAdapter.scan();
    expect(schema.page.hasNext).toBe(true);
    expect(schema.page.hasSubmit).toBe(true);
  });
});
