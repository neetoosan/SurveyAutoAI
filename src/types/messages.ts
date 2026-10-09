import type { SurveyDOMSchema } from './survey';
import type { AnswerRecord, PlannedAnswer, RespondentProfile } from './respondent';
import type { CaptchaChallenge } from '@/dom/tripwire';
import type { CustomPersona } from '@/storage/personas';

export interface ValidationFinding {
  severity: 'error' | 'warning' | 'info';
  questionId?: string;
  code: string;
  message: string;
}

export interface RunSummary {
  runId: string;
  respondent: RespondentProfile;
  schema: SurveyDOMSchema;
  answers: AnswerRecord[];
  findings: ValidationFinding[];
  startedAt: number;
  finishedAt?: number;
  submitted: boolean;
}

export type EmulationSpeed = 'human' | 'instant';

/** Side panel -> background. */
export type PanelRequest =
  | { type: 'SCAN_PAGE_REQUEST' }
  | { type: 'PLAN_ANSWERS_REQUEST'; payload: { schema: SurveyDOMSchema; respondentId: string } }
  | {
      type: 'FILL_PAGE_REQUEST';
      payload: {
        schema: SurveyDOMSchema;
        answers: PlannedAnswer[];
        dryRun: boolean;
        emulationMode?: EmulationSpeed;
      };
    }
  | { type: 'ADVANCE_PAGE_REQUEST' }
  | { type: 'SUBMIT_REQUEST'; payload: { confirmToken: string } }
  | { type: 'CLEAR_HIGHLIGHTS_REQUEST' }
  | { type: 'GET_STATE_REQUEST' }
  | { type: 'EXPORT_RUN_REQUEST'; payload: { runId: string; format: 'json' | 'csv' } }
  | { type: 'RESUME_REQUEST' }
  | { type: 'CHECK_TRIPWIRE_REQUEST' }
  | { type: 'SET_EMULATION_MODE_REQUEST'; payload: { mode: EmulationSpeed } }
  | { type: 'GET_ACTIVE_TAB_REQUEST' }
  | { type: 'ISSUE_SUBMIT_TOKEN' }
  | { type: 'START_SPEEDRUN_REQUEST'; payload: { respondentId: string; autoSubmit?: boolean } }
  | { type: 'STOP_SPEEDRUN_REQUEST' }
  | { type: 'LIST_PERSONAS_REQUEST' }
  | { type: 'SAVE_PERSONA_REQUEST'; payload: { persona: CustomPersona } }
  | { type: 'DELETE_PERSONA_REQUEST'; payload: { id: string } }
  | { type: 'UPDATE_PLANNED_ANSWER_REQUEST'; payload: { answer: PlannedAnswer } }
  | { type: 'GET_SELECTED_MODEL_REQUEST' }
  | { type: 'SET_SELECTED_MODEL_REQUEST'; payload: { model: string } };

/** Background -> content script. */
export type ContentCommand =
  | { type: 'SCAN_PAGE' }
  | {
      type: 'FILL_PAGE';
      payload: {
        answers: PlannedAnswer[];
        schema: SurveyDOMSchema;
        dryRun: boolean;
        emulationMode?: EmulationSpeed;
      };
    }
  | { type: 'ADVANCE_PAGE' }
  | { type: 'SUBMIT_PAGE' }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'PROBE_VALIDATION' }
  | { type: 'CHECK_TRIPWIRE' };

/** Content script -> background responses. */
export type ContentResponse =
  | { type: 'SCAN_RESULT'; payload: SurveyDOMSchema }
  | { type: 'FILL_RESULT'; payload: { records: AnswerRecord[]; findings: ValidationFinding[] } }
  | { type: 'NAVIGATION_RESULT'; payload: { advanced: boolean; findings: ValidationFinding[] } }
  | { type: 'VALIDATION_RESULT'; payload: { findings: ValidationFinding[] } }
  | { type: 'TRIPWIRE_RESULT'; payload: { challenge: CaptchaChallenge | null } }
  | { type: 'ACK' }
  | { type: 'ERROR'; payload: { message: string } };

/** Background -> side panel push events. */
export type BackgroundEvent =
  | { type: 'LOG'; payload: { level: 'info' | 'warn' | 'error'; message: string; at: number } }
  | { type: 'STATE'; payload: SessionState }
  | { type: 'TOKENS'; payload: { promptTokens: number; responseTokens: number; calls: number } }
  | { type: 'TRIPWIRE'; payload: CaptchaChallenge };

export type SessionPhase =
  | 'idle'
  | 'scanning'
  | 'planning'
  | 'awaiting-approval'
  | 'filling'
  | 'navigating'
  | 'speedrun'
  | 'paused'
  | 'complete'
  | 'error';

export interface SessionState {
  phase: SessionPhase;
  tabId?: number;
  origin?: string;
  ownershipConfirmed: boolean;
  schema?: SurveyDOMSchema;
  plan?: PlannedAnswer[];
  run?: RunSummary;
  lastError?: string;
  tripwire?: CaptchaChallenge;
  emulationMode?: EmulationSpeed;
}
