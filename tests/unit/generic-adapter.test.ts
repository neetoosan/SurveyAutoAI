import { beforeEach, describe, expect, it } from 'vitest';
import { genericFormAdapter } from '@/adapters/generic-form';
import { loadMockSurvey } from './helpers';

describe('genericFormAdapter', () => {
  beforeEach(loadMockSurvey);

  it('detects a page containing form controls', () => {
    expect(genericFormAdapter.detect()).toBe(true);
  });

  it('groups radio inputs sharing a name into one question', () => {
    const schema = genericFormAdapter.scan();
    const carQuestion = schema.page.questions.find((q) => q.label.includes('own a car'));

    expect(carQuestion).toBeDefined();
    expect(carQuestion!.type).toBe('radio');
    expect(carQuestion!.options).toHaveLength(2);
    expect(carQuestion!.options!.map((o) => o.label)).toEqual(['Yes', 'No']);
  });

  it('groups checkbox inputs sharing a name into one question', () => {
    const schema = genericFormAdapter.scan();
    const tools = schema.page.questions.find((q) => q.label.includes('Which tools'));

    expect(tools).toBeDefined();
    expect(tools!.type).toBe('checkbox');
    expect(tools!.options).toHaveLength(3);
  });

  it('reads select options and skips the placeholder', () => {
    const schema = genericFormAdapter.scan();
    const role = schema.page.questions.find((q) => q.id === 'role');

    expect(role!.type).toBe('dropdown');
    expect(role!.options!.map((o) => o.label)).toEqual(['Engineering', 'Design', 'Operations']);
  });

  it('carries maxLength through as a constraint', () => {
    const schema = genericFormAdapter.scan();
    const name = schema.page.questions.find((q) => q.id === 'full-name');

    expect(name!.required).toBe(true);
    expect(name!.constraints?.maxLength).toBe(40);
  });

  it('reads range bounds as a scale', () => {
    const schema = genericFormAdapter.scan();
    const satisfaction = schema.page.questions.find((q) => q.id === 'satisfaction');

    expect(satisfaction!.type).toBe('likert');
    expect(satisfaction!.scale).toEqual({ min: 1, max: 10 });
  });

  it('reports hidden and off-screen inputs as skipped instead of filling them', () => {
    const schema = genericFormAdapter.scan();
    const reasons = schema.skipped.map((s) => s.reason);

    expect(reasons).toContain('input type=hidden');
    expect(reasons.some((r) => r.includes('off-screen'))).toBe(true);

    // The honeypot must not appear as an answerable question.
    expect(schema.page.questions.some((q) => q.id === 'trap')).toBe(false);
  });

  it('ignores button-like inputs', () => {
    const schema = genericFormAdapter.scan();
    expect(schema.page.questions.every((q) => q.type !== null)).toBe(true);
    expect(schema.page.questions.find((q) => q.label === 'Next')).toBeUndefined();
  });

  it('locates the next control on the first page', () => {
    expect(genericFormAdapter.findNextControl()?.id).toBe('next');
  });
});
