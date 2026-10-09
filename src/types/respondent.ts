/**
 * Test respondents are synthetic QA inputs for forms the operator owns.
 * They exist to exercise branching and validation paths, not to impersonate
 * real people on someone else's survey.
 */

export interface RespondentProfile {
  id: string;
  /** Human-readable label shown in the run log, e.g. "Edge case: max length". */
  name: string;
  /** What this respondent is meant to probe. */
  intent: string;
  /** Free-form traits that keep multi-question answers mutually coherent. */
  traits: Record<string, string | number | boolean>;
  /** Preferred answer style for free-text fields. */
  textStyle?: {
    length: 'terse' | 'moderate' | 'verbose';
    tone?: string;
  };
}

export type RespondentPresetId =
  | 'happy-path'
  | 'minimal-required-only'
  | 'boundary-max-length'
  | 'boundary-min-length'
  | 'branch-explorer'
  | 'unicode-and-symbols';

export interface RespondentPreset {
  id: RespondentPresetId;
  label: string;
  description: string;
  build: () => Omit<RespondentProfile, 'id'>;
}

/** One question/answer pair recorded during a run. */
export interface AnswerRecord {
  questionId: string;
  questionLabel: string;
  questionType: string;
  value: AnswerValue;
  rationale?: string;
  filledAt: number;
  /** Set when the fill engine could not apply the answer. */
  error?: string;
}

export interface AnswerValue {
  selectedOptionIndex?: number | null;
  selectedOptionIndexes?: number[] | null;
  likertValue?: number | null;
  textAnswer?: string | null;
  /** Matrix answers: row index -> column index. */
  matrixSelections?: Record<string, number> | null;
}

export interface PlannedAnswer extends AnswerValue {
  questionId: string;
  rationale: string;
  /** Model's own flag that it could not confidently answer. */
  uncertain?: boolean;
}
