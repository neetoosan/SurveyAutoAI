import type { RespondentPreset, RespondentProfile } from '@/types/respondent';

/**
 * Test respondents exist to drive a form you own down a specific path.
 * Each preset targets a class of form defect: unreachable branches, required
 * fields that do not enforce, length limits that truncate silently, and so on.
 */
export const respondentPresets: RespondentPreset[] = [
  {
    id: 'happy-path',
    label: 'Happy path',
    description: 'Plausible, internally consistent answers to every question. Baseline run.',
    build: () => ({
      name: 'Happy path',
      intent:
        'Answer every question plausibly and consistently. Establish the baseline path through the form.',
      traits: { consistency: 'high', completeness: 'answers everything' },
      textStyle: { length: 'moderate' },
    }),
  },
  {
    id: 'minimal-required-only',
    label: 'Required only',
    description:
      'Fills required questions and leaves the rest blank. Verifies optional fields really are optional.',
    build: () => ({
      name: 'Required only',
      intent:
        'Answer ONLY questions marked required. Return no answer at all for optional questions, so the form can be checked for falsely-enforced optional fields.',
      traits: { completeness: 'required only' },
      textStyle: { length: 'terse' },
    }),
  },
  {
    id: 'boundary-max-length',
    label: 'Max-length boundary',
    description: 'Pushes text fields to their declared maxLength and scales to their upper bound.',
    build: () => ({
      name: 'Max-length boundary',
      intent:
        'For every text field, produce an answer exactly at the declared maxLength (or 500 characters when none is declared). For every scale, choose the maximum value. For choice questions, select the LAST option.',
      traits: { boundary: 'upper' },
      textStyle: { length: 'verbose' },
    }),
  },
  {
    id: 'boundary-min-length',
    label: 'Min-length boundary',
    description: 'Shortest legal input everywhere. Surfaces over-strict validation.',
    build: () => ({
      name: 'Min-length boundary',
      intent:
        'Give the shortest input that should still be accepted: a single character where no minLength is declared, exactly minLength where one is. For scales choose the minimum; for choice questions select the FIRST option.',
      traits: { boundary: 'lower' },
      textStyle: { length: 'terse' },
    }),
  },
  {
    id: 'branch-explorer',
    label: 'Branch explorer',
    description:
      'Deliberately picks options that open conditional logic, to reach rarely-tested pages.',
    build: () => ({
      name: 'Branch explorer',
      intent:
        'Prefer whichever option is most likely to trigger conditional follow-up questions: "Yes" over "No", "Other" over a listed choice, and the option whose wording implies further detail is needed. The goal is to reach branches the baseline run never sees.',
      traits: { strategy: 'maximize branch coverage' },
      textStyle: { length: 'moderate' },
    }),
  },
  {
    id: 'unicode-and-symbols',
    label: 'Unicode and symbols',
    description:
      'Non-ASCII text, emoji, RTL, and quote characters. Checks encoding and escaping end to end.',
    build: () => ({
      name: 'Unicode and symbols',
      intent:
        'Fill text fields with a mix of non-ASCII content: accented Latin, CJK, Arabic (RTL), emoji, curly quotes, ampersands and angle brackets. Answers should stay relevant to the question but exercise encoding. Choice and scale questions get ordinary mid-range answers.',
      traits: { charset: 'unicode stress' },
      textStyle: { length: 'moderate' },
    }),
  },
];

export function buildRespondent(presetId: string): RespondentProfile {
  const preset = respondentPresets.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Unknown respondent preset: ${presetId}`);
  return { id: `${preset.id}-${Date.now().toString(36)}`, ...preset.build() };
}

export function customRespondent(name: string, intent: string): RespondentProfile {
  return {
    id: `custom-${Date.now().toString(36)}`,
    name,
    intent,
    traits: {},
    textStyle: { length: 'moderate' },
  };
}
