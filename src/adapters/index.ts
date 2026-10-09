import type { SurveyDOMSchema } from '@/types/survey';
import type { SurveyAdapter } from './base';
import { googleFormsAdapter } from './google-forms';
import { typeformAdapter } from './typeform';
import { qualtricsAdapter } from './qualtrics';
import { surveymonkeyAdapter } from './surveymonkey';
import { genericFormAdapter } from './generic-form';

/** Ordered most-specific first; the generic scraper is the terminal fallback. */
export const adapters: SurveyAdapter[] = [
  googleFormsAdapter,
  typeformAdapter,
  qualtricsAdapter,
  surveymonkeyAdapter,
  genericFormAdapter,
];

export function pickAdapter(): SurveyAdapter {
  return adapters.find((a) => a.detect()) ?? genericFormAdapter;
}

export function scanActivePage(): SurveyDOMSchema {
  return pickAdapter().scan();
}

export * from './base';
