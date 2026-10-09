import { create } from 'zustand';
import type { PlannedAnswer } from '@/types/respondent';
import type { RunSummary, SessionState, SessionPhase, EmulationSpeed } from '@/types/messages';
import type { SurveyDOMSchema } from '@/types/survey';
import type { CaptchaChallenge } from '@/dom/tripwire';

export interface LogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: number;
}

interface PanelStore {
  phase: SessionPhase;
  schema?: SurveyDOMSchema;
  plan?: PlannedAnswer[];
  run?: RunSummary;
  origin?: string;
  ownershipConfirmed: boolean;
  lastError?: string;
  tripwire?: CaptchaChallenge;
  emulationMode: EmulationSpeed;
  soundEnabled: boolean;
  logs: LogLine[];
  tokens: { promptTokens: number; responseTokens: number; calls: number };
  selectedPersonaId: string;
  speedrunAutoSubmit: boolean;

  applyState: (state: SessionState) => void;
  appendLog: (line: LogLine) => void;
  setTokens: (tokens: PanelStore['tokens']) => void;
  setEmulationMode: (mode: EmulationSpeed) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSelectedPersonaId: (id: string) => void;
  setSpeedrunAutoSubmit: (val: boolean) => void;
  updatePlanAnswer: (answer: PlannedAnswer) => void;
  clearLogs: () => void;
}

const MAX_LOG_LINES = 300;

export const usePanelStore = create<PanelStore>((set) => ({
  phase: 'idle',
  ownershipConfirmed: false,
  emulationMode: 'human',
  soundEnabled: true,
  logs: [],
  tokens: { promptTokens: 0, responseTokens: 0, calls: 0 },
  selectedPersonaId: 'happy-path',
  speedrunAutoSubmit: false,

  applyState: (state) =>
    set({
      phase: state.phase,
      schema: state.schema,
      plan: state.plan,
      run: state.run,
      origin: state.origin,
      ownershipConfirmed: state.ownershipConfirmed,
      lastError: state.lastError,
      tripwire: state.tripwire,
      emulationMode: state.emulationMode ?? 'human',
    }),

  appendLog: (line) => set((prev) => ({ logs: [...prev.logs, line].slice(-MAX_LOG_LINES) })),

  setTokens: (tokens) => set({ tokens }),

  setEmulationMode: (mode) => set({ emulationMode: mode }),

  setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),

  setSelectedPersonaId: (id) => set({ selectedPersonaId: id }),

  setSpeedrunAutoSubmit: (val) => set({ speedrunAutoSubmit: val }),

  updatePlanAnswer: (answer) =>
    set((prev) => {
      if (!prev.plan) return {};
      const nextPlan = prev.plan.map((a) => (a.questionId === answer.questionId ? answer : a));
      return { plan: nextPlan };
    }),

  clearLogs: () => set({ logs: [] }),
}));
