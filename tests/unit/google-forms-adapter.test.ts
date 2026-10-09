import { beforeEach, describe, expect, it } from 'vitest';
import { googleFormsAdapter } from '@/adapters/google-forms';
import { loadGoogleForms } from './helpers';

describe('googleFormsAdapter', () => {
  beforeEach(loadGoogleForms);

  it('detects a Google Forms document structure', () => {
    expect(googleFormsAdapter.detect()).toBe(true);
  });

  it('scans form title and page progress', () => {
    const schema = googleFormsAdapter.scan();
    expect(schema.platform).toBe('google-forms');
    expect(schema.title).toContain('Team Feedback Form');
    expect(schema.page.pageIndex).toBe(0);
  });

  it('parses radio buttons with companion "Other" text entry', () => {
    const schema = googleFormsAdapter.scan();
    const locationQ = schema.page.questions.find((q) => q.label.includes('Work Location'));

    expect(locationQ).toBeDefined();
    expect(locationQ!.type).toBe('radio');
    expect(locationQ!.required).toBe(true);
    expect(locationQ!.options?.map((o) => o.label)).toEqual([
      'Remote',
      'Hybrid',
      'Other: (with text entry)',
    ]);
  });

  it('parses checkbox questions correctly', () => {
    const schema = googleFormsAdapter.scan();
    const toolsQ = schema.page.questions.find((q) => q.label.includes('Tools Used Daily'));

    expect(toolsQ).toBeDefined();
    expect(toolsQ!.type).toBe('checkbox');
    expect(toolsQ!.options?.map((o) => o.label)).toEqual(['VS Code', 'Terminal', 'Git']);
  });

  it('parses linear scale questions into likert type with scale bounds', () => {
    const schema = googleFormsAdapter.scan();
    const satisfactionQ = schema.page.questions.find((q) =>
      q.label.includes('Overall Satisfaction'),
    );

    expect(satisfactionQ).toBeDefined();
    expect(satisfactionQ!.type).toBe('likert');
    expect(satisfactionQ!.scale).toEqual({
      min: 1,
      max: 5,
      minLabel: 'Very Dissatisfied',
      maxLabel: 'Very Satisfied',
    });
  });

  it('parses multiple-choice grid (matrix) questions with rows and columns', () => {
    const schema = googleFormsAdapter.scan();
    const gridQ = schema.page.questions.find((q) => q.label.includes('Workplace Ratings'));

    expect(gridQ).toBeDefined();
    expect(gridQ!.type).toBe('matrix');
    expect(gridQ!.rows?.map((r) => r.label)).toEqual(['Collaboration', 'Autonomy']);
    expect(gridQ!.options?.map((c) => c.label)).toEqual(['Low', 'Medium', 'High']);
  });

  it('parses dropdown questions and ignores the "Choose" placeholder', () => {
    const schema = googleFormsAdapter.scan();
    const deptQ = schema.page.questions.find((q) => q.label.includes('Department'));

    expect(deptQ).toBeDefined();
    expect(deptQ!.type).toBe('dropdown');
    expect(deptQ!.options?.map((o) => o.label)).toEqual(['Engineering', 'Design', 'Marketing']);
  });

  it('identifies next and submit navigation controls', () => {
    const schema = googleFormsAdapter.scan();
    expect(schema.page.hasNext).toBe(true);
    expect(schema.page.hasSubmit).toBe(true);
  });
});
