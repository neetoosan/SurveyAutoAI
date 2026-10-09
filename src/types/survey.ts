/** Normalized question model produced by every platform adapter. */

export type QuestionType =
  'likert' | 'radio' | 'checkbox' | 'dropdown' | 'text' | 'textarea' | 'matrix' | 'date' | 'number';

export interface QuestionOption {
  label: string;
  /** Stable handle the fill engine uses to re-find this option's element. */
  elementRefId: string;
}

export interface ScaleBounds {
  min: number;
  max: number;
  minLabel?: string;
  maxLabel?: string;
}

export interface MatrixRow {
  label: string;
  elementRefId: string;
}

export interface SurveyQuestion {
  /** Stable identifier: platform-native id when available, else a content hash. */
  id: string;
  index: number;
  /** Clean question prompt with helper chrome stripped. */
  label: string;
  /** Secondary instructions or subtitle text. */
  description?: string;
  type: QuestionType;
  required: boolean;
  options?: QuestionOption[];
  scale?: ScaleBounds;
  /** Matrix questions carry rows; `options` then holds the shared columns. */
  rows?: MatrixRow[];
  /** Resolvable reference back to the container element. */
  domRef: string;
  /** Validation constraints the adapter could read off the DOM. */
  constraints?: {
    maxLength?: number;
    minLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
  };
}

export type PlatformId = 'google-forms' | 'typeform' | 'qualtrics' | 'surveymonkey' | 'generic';

export interface SurveyPage {
  /** 0-based index of the current page within a multi-page survey. */
  pageIndex: number;
  questions: SurveyQuestion[];
  /** True when the adapter can see a next/continue control. */
  hasNext: boolean;
  /** True when the adapter can see a submit control. */
  hasSubmit: boolean;
}

export interface SurveyDOMSchema {
  platform: PlatformId;
  title: string;
  url: string;
  origin: string;
  page: SurveyPage;
  /** Inputs the adapter found but deliberately skipped, with the reason. */
  skipped: Array<{ domRef: string; reason: string }>;
  scannedAt: number;
}
