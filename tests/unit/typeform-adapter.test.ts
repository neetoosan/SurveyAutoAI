import { beforeEach, describe, expect, it } from 'vitest';
import { typeformAdapter } from '@/adapters/typeform';
import { loadTypeform } from './helpers';

describe('typeformAdapter', () => {
  beforeEach(loadTypeform);

  it('detects a Typeform block structure', () => {
    expect(typeformAdapter.detect()).toBe(true);
  });

  it('scans the active block and reports progress percentage', () => {
    const schema = typeformAdapter.scan();
    expect(schema.platform).toBe('typeform');
    expect(schema.title).toContain('Typeform - Product Feedback');
    expect(schema.page.pageIndex).toBe(50);
  });

  it('isolates the active question block with choices and key badges', () => {
    const schema = typeformAdapter.scan();
    expect(schema.page.questions).toHaveLength(1);

    const q = schema.page.questions[0]!;
    expect(q.id).toBe('block_role_1');
    expect(q.label).toContain('What is your primary role?');
    expect(q.type).toBe('radio');
    expect(q.required).toBe(true);
    expect(q.options?.map((o) => o.label)).toEqual([
      'A. Frontend Engineer',
      'B. Backend Engineer',
      'C. Product Manager',
    ]);
  });

  it('identifies the OK next control and submit control', () => {
    const schema = typeformAdapter.scan();
    expect(schema.page.hasNext).toBe(true);
    expect(schema.page.hasSubmit).toBe(true);
  });
});
