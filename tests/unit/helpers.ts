import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resetRefs } from '@/adapters/base';

export const MOCK_SURVEY = readFileSync(resolve(__dirname, '../fixtures/mock-survey.html'), 'utf8');
export const GOOGLE_FORMS_FIXTURE = readFileSync(resolve(__dirname, '../fixtures/google-forms.html'), 'utf8');
export const TYPEFORM_FIXTURE = readFileSync(resolve(__dirname, '../fixtures/typeform.html'), 'utf8');
export const QUALTRICS_FIXTURE = readFileSync(resolve(__dirname, '../fixtures/qualtrics.html'), 'utf8');
export const SURVEYMONKEY_FIXTURE = readFileSync(resolve(__dirname, '../fixtures/surveymonkey.html'), 'utf8');

/**
 * happy-dom does no layout, so getBoundingClientRect returns zeros for every
 * element and the adapter's visibility filter would drop the whole form. This
 * stub derives a plausible box from the computed style instead, so that
 * display:none and opacity:0 still read as invisible and everything else does
 * not.
 */
function stubLayout(): void {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const view = this.ownerDocument?.defaultView;
    const style = view?.getComputedStyle(this);
    const opacity = Number.parseFloat(style?.opacity ?? '');
    const hidden = style?.display === 'none' || (Number.isFinite(opacity) && opacity === 0);
    const box = hidden ? 0 : 20;
    return {
      x: 0,
      y: 0,
      width: box,
      height: box,
      top: 0,
      right: box,
      bottom: box,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  // Not implemented in happy-dom; the fill engine calls it before activating.
  Element.prototype.scrollIntoView = () => {};
}

function loadHtml(html: string): void {
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
  stubLayout();
  resetRefs();
}

/** Load the mock survey into the test document and reset scanner state. */
export function loadMockSurvey(): void {
  loadHtml(MOCK_SURVEY);
}

export function loadGoogleForms(): void {
  loadHtml(GOOGLE_FORMS_FIXTURE);
}

export function loadTypeform(): void {
  loadHtml(TYPEFORM_FIXTURE);
}

export function loadQualtrics(): void {
  loadHtml(QUALTRICS_FIXTURE);
}

export function loadSurveyMonkey(): void {
  loadHtml(SURVEYMONKEY_FIXTURE);
}
