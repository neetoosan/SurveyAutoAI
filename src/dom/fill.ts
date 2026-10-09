import type { AnswerRecord, PlannedAnswer } from '@/types/respondent';
import type { EmulationSpeed, ValidationFinding } from '@/types/messages';
import type { SurveyDOMSchema, SurveyQuestion } from '@/types/survey';
import { resolveRef, visibilityReport } from '@/adapters';
import {
  gaussianRandom,
  scrollIntoViewHuman,
  setNativeValue,
  simulateHumanClick,
  simulateHumanInput,
  simulateSelectDropdown,
  sleep,
  type EmulationOptions,
} from './emulation';
import { detectCaptcha, isHoneypot } from './tripwire';

/**
 * Applies planned answers to the page using human-grade DOM emulation (Phase 4).
 *
 * Dispatches complete event lifecycles with natural typing jitter, synthetic
 * mouse paths, smooth scrolling, and strict honeypot avoidance.
 */

function findContainer(question: SurveyQuestion): Element | null {
  return resolveRef(question.domRef);
}

/**
 * A question's domRef is the group container for grouped inputs, but the
 * control itself for a standalone one. querySelector only walks descendants,
 * so the container has to be tested before being searched.
 */
function controlWithin<T extends Element>(container: Element, selector: string): T | null {
  if (container.matches(selector)) return container as T;
  return container.querySelector<T>(selector);
}

/** Resolve an option ref, supporting the `idx<n>` form used for select elements. */
function resolveOption(question: SurveyQuestion, index: number): Element | null {
  const option = question.options?.[index];
  if (!option) return null;
  if (option.elementRefId.startsWith('idx')) {
    const container = findContainer(question);
    return container ? controlWithin(container, 'select') : null;
  }
  return resolveRef(option.elementRefId);
}

async function applyAnswer(
  question: SurveyQuestion,
  answer: PlannedAnswer,
  options?: EmulationOptions,
): Promise<void> {
  const container = findContainer(question);
  if (!container) throw new Error(`container ${question.domRef} no longer in the DOM`);

  // Honeypot trap avoidance
  const trapCheck = isHoneypot(container);
  if (trapCheck.isTrap) {
    throw new Error(`Refused to fill honeypot trap: ${trapCheck.reason}`);
  }

  switch (question.type) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'date': {
      const field = controlWithin<HTMLInputElement | HTMLTextAreaElement>(
        container,
        'input, textarea',
      );
      if (!field) throw new Error('no text field in or at the question reference');
      const fieldTrap = isHoneypot(field);
      if (fieldTrap.isTrap) {
        throw new Error(`Refused to fill honeypot input field: ${fieldTrap.reason}`);
      }
      await simulateHumanInput(field, answer.textAnswer ?? '', options);
      return;
    }

    case 'radio':
    case 'dropdown': {
      const index = answer.selectedOptionIndex;
      if (index == null) throw new Error('no option index planned');
      const target = resolveOption(question, index);
      if (!target) throw new Error(`option ${index} not resolvable`);
      const targetTrap = isHoneypot(target);
      if (targetTrap.isTrap) {
        throw new Error(`Refused to interact with honeypot option: ${targetTrap.reason}`);
      }
      if (target instanceof HTMLSelectElement) {
        const optionRef = question.options?.[index]?.elementRefId ?? '';
        // Option refs are zero-based over the non-empty options; the live
        // select still carries its placeholder at position 0.
        await simulateSelectDropdown(target, Number(optionRef.replace('idx', '')) + 1, options);
      } else {
        // If it's an ARIA option in a listbox that is closed, click the listbox first
        const listbox = target.closest('div[role="listbox"]');
        if (listbox && listbox.getAttribute('aria-expanded') === 'false') {
          await simulateHumanClick(listbox, options);
          if (options?.speed !== 'instant') await sleep(60);
        }
        await simulateHumanClick(target, options);
      }

      // Check if this option has a companion text input (e.g. Google Forms "Other:")
      const companion = target.closest('label, div[role="presentation"]')?.querySelector<HTMLInputElement>(
        'input.Hvn9fb, input[type="text"]',
      );
      if (companion && answer.textAnswer) {
        await simulateHumanInput(companion, answer.textAnswer, options);
      }
      return;
    }

    case 'checkbox': {
      const indexes = answer.selectedOptionIndexes ?? [];
      for (const index of indexes) {
        const target = resolveOption(question, index);
        if (!target) throw new Error(`option ${index} not resolvable`);
        const targetTrap = isHoneypot(target);
        if (targetTrap.isTrap) {
          throw new Error(`Refused to interact with honeypot checkbox: ${targetTrap.reason}`);
        }
        await simulateHumanClick(target, options);

        // Check for companion text input on "Other" option
        const companion = target.closest('label, div[role="presentation"]')?.querySelector<HTMLInputElement>(
          'input.Hvn9fb, input[type="text"]',
        );
        if (companion && answer.textAnswer) {
          await simulateHumanInput(companion, answer.textAnswer, options);
        }

        if (options?.speed !== 'instant') {
          await sleep(gaussianRandom(80, 200));
        }
      }
      return;
    }

    case 'likert': {
      const value = answer.likertValue;
      if (value == null) throw new Error('no likert value planned');
      const slider = controlWithin<HTMLInputElement>(container, 'input[type="range"]');
      if (slider) {
        await scrollIntoViewHuman(slider, options);
        setNativeValue(slider, String(value));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const match = question.options?.findIndex((o) => Number(o.label) === value);
      const target = match != null && match >= 0 ? resolveOption(question, match) : null;
      if (!target) throw new Error(`no control for likert value ${value}`);
      await simulateHumanClick(target, options);
      return;
    }

    case 'matrix': {
      const selections = answer.matrixSelections ?? {};
      for (const [rowRef, columnIndex] of Object.entries(selections)) {
        const row = resolveRef(rowRef);
        if (!row) throw new Error(`matrix row ${rowRef} not resolvable`);
        const inputs = Array.from(row.querySelectorAll('input, div[role="radio"], div[role="checkbox"]'));
        const input = inputs[columnIndex];
        if (!input) throw new Error(`matrix column ${columnIndex} not present in row`);
        await simulateHumanClick(input, options);
        if (options?.speed !== 'instant') {
          await sleep(gaussianRandom(100, 240));
        }
      }
      return;
    }

    default:
      throw new Error(`unsupported question type: ${question.type}`);
  }
}

export interface FillOutcome {
  records: AnswerRecord[];
  findings: ValidationFinding[];
}

export async function fillPage(
  schema: SurveyDOMSchema,
  answers: PlannedAnswer[],
  options: { dryRun: boolean; emulationMode?: EmulationSpeed },
): Promise<FillOutcome> {
  const records: AnswerRecord[] = [];
  const findings: ValidationFinding[] = [];
  const byId = new Map(schema.page.questions.map((q) => [q.id, q]));
  const answered = new Set<string>();

  // Tripwire pre-check: abort automated fill if CAPTCHA challenge is active
  const challenge = detectCaptcha();
  if (challenge) {
    findings.push({
      severity: 'error',
      code: 'CAPTCHA_TRIPWIRE',
      message: `Execution halted: ${challenge.description} detected on page.`,
    });
    return { records, findings };
  }

  const speed: EmulationSpeed = options.emulationMode ?? 'human';
  const emulationOpts: EmulationOptions = { speed };

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i]!;
    const question = byId.get(answer.questionId);
    if (!question) {
      findings.push({
        severity: 'warning',
        code: 'ORPHAN_ANSWER',
        questionId: answer.questionId,
        message: `Planner returned an answer for unknown question id ${answer.questionId}.`,
      });
      continue;
    }

    answered.add(question.id);
    const record: AnswerRecord = {
      questionId: question.id,
      questionLabel: question.label,
      questionType: question.type,
      value: answer,
      rationale: answer.rationale,
      filledAt: Date.now(),
    };

    if (answer.uncertain) {
      findings.push({
        severity: 'info',
        code: 'PLANNER_UNCERTAIN',
        questionId: question.id,
        message: `Planner flagged low confidence: ${answer.rationale}`,
      });
    }

    if (!options.dryRun) {
      try {
        await applyAnswer(question, answer, emulationOpts);

        // Natural human pause between answering consecutive questions
        if (speed !== 'instant' && i < answers.length - 1) {
          await sleep(gaussianRandom(200, 500));
        }
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        findings.push({
          severity: 'error',
          code: 'FILL_FAILED',
          questionId: question.id,
          message: `Could not fill "${question.label}": ${record.error}`,
        });
      }
    }

    records.push(record);
  }

  for (const question of schema.page.questions) {
    if (question.required && !answered.has(question.id)) {
      findings.push({
        severity: 'error',
        code: 'REQUIRED_UNANSWERED',
        questionId: question.id,
        message: `Required question "${question.label}" received no planned answer.`,
      });
    }
  }

  findings.push(...auditSkipped(schema));
  return { records, findings };
}

/**
 * Hidden inputs and honeypot traps are reported, never filled.
 */
function auditSkipped(schema: SurveyDOMSchema): ValidationFinding[] {
  return schema.skipped
    .filter((s) => /hidden|display:none|opacity|zero bounding|trap|honeypot/i.test(s.reason))
    .map((s) => ({
      severity: 'info' as const,
      code: /trap|honeypot|off-screen/i.test(s.reason) ? 'HONEYPOT_TRAP' : 'HIDDEN_INPUT',
      message: `Skipped non-interactive trap (${s.reason}) at ${s.domRef}. Protected from fill.`,
    }));
}

/** Read validation errors the form surfaced after a fill or a failed advance. */
export function collectValidationErrors(): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const selectors = [
    '[role="alert"]',
    '[aria-invalid="true"]',
    '.ValidationError',
    '.error, .field-error, .invalid-feedback',
    '[data-qa="question-error"]',
  ];

  for (const el of document.querySelectorAll(selectors.join(', '))) {
    if (!visibilityReport(el).visible) continue;
    const message = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!message) continue;
    findings.push({
      severity: 'warning',
      code: 'FORM_VALIDATION_ERROR',
      message,
    });
  }

  for (const el of document.querySelectorAll<HTMLInputElement>('input, select, textarea')) {
    if (el.willValidate && !el.checkValidity()) {
      findings.push({
        severity: 'warning',
        code: 'CONSTRAINT_VIOLATION',
        message: `${el.name || el.id || el.type}: ${el.validationMessage}`,
      });
    }
  }

  return findings;
}
