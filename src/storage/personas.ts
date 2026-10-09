import type { RespondentProfile } from '@/types/respondent';
import { buildRespondent, respondentPresets } from '@/ai/respondents';

export interface CustomPersona {
  id: string;
  name: string;
  description?: string;
  demographics: {
    age?: number | string;
    profession?: string;
    income?: string;
    education?: string;
    location?: string;
    techProficiency?: 'low' | 'moderate' | 'high' | 'expert';
  };
  biasesAndPreferences: string[];
  communicationStyle: {
    tone?: string;
    length: 'terse' | 'moderate' | 'verbose';
    customInstructions?: string;
  };
  createdAt: number;
  updatedAt: number;
}

const PERSONAS_STORAGE_KEY = 'saqa.customPersonas';

// In-memory fallback for node/vitest test environments without chrome.storage
const memoryStore: Record<string, unknown> = {};

function getStorageArea(): {
  get: (keys: string | string[]) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
} {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    return chrome.storage.sync;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return {
    get: async (keys) => {
      const result: Record<string, unknown> = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) {
        if (k in memoryStore) result[k] = memoryStore[k];
      }
      return result;
    },
    set: async (items) => {
      Object.assign(memoryStore, items);
    },
    remove: async (keys) => {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) delete memoryStore[k];
    },
  };
}

export function customPersonaToProfile(persona: CustomPersona): RespondentProfile {
  const traits: Record<string, string | number | boolean> = {};
  if (persona.demographics.age) traits.age = String(persona.demographics.age);
  if (persona.demographics.profession) traits.profession = persona.demographics.profession;
  if (persona.demographics.income) traits.income = persona.demographics.income;
  if (persona.demographics.education) traits.education = persona.demographics.education;
  if (persona.demographics.location) traits.location = persona.demographics.location;
  if (persona.demographics.techProficiency) {
    traits.techProficiency = persona.demographics.techProficiency;
  }
  if (persona.biasesAndPreferences && persona.biasesAndPreferences.length > 0) {
    traits.biasesAndPreferences = persona.biasesAndPreferences.join('; ');
  }
  if (persona.communicationStyle.customInstructions) {
    traits.specialInstructions = persona.communicationStyle.customInstructions;
  }

  const intentParts = [
    `Emulate ${persona.name}.`,
    persona.description,
    persona.demographics.profession ? `Profession: ${persona.demographics.profession}.` : '',
    persona.biasesAndPreferences && persona.biasesAndPreferences.length > 0
      ? `Core Biases & Preferences: ${persona.biasesAndPreferences.join(', ')}.`
      : '',
    persona.communicationStyle.customInstructions
      ? `Guidance: ${persona.communicationStyle.customInstructions}`
      : '',
  ].filter(Boolean);

  return {
    id: persona.id,
    name: persona.name,
    intent: intentParts.join(' '),
    traits,
    textStyle: {
      length: persona.communicationStyle.length ?? 'moderate',
      tone: persona.communicationStyle.tone,
    },
  };
}

export async function loadCustomPersonas(): Promise<CustomPersona[]> {
  try {
    const storage = getStorageArea();
    const result = await storage.get(PERSONAS_STORAGE_KEY);
    const data = result[PERSONAS_STORAGE_KEY];
    return Array.isArray(data) ? (data as CustomPersona[]) : [];
  } catch (error) {
    console.warn('Failed to load custom personas from storage:', error);
    return [];
  }
}

export async function saveCustomPersona(persona: CustomPersona): Promise<void> {
  const current = await loadCustomPersonas();
  const existingIndex = current.findIndex((p) => p.id === persona.id);
  const now = Date.now();
  const toSave: CustomPersona = {
    ...persona,
    updatedAt: now,
    createdAt: persona.createdAt || now,
  };

  if (existingIndex >= 0) {
    current[existingIndex] = toSave;
  } else {
    current.push(toSave);
  }

  const storage = getStorageArea();
  try {
    await storage.set({ [PERSONAS_STORAGE_KEY]: current });
  } catch {
    // If sync storage exceeded quota, fallback to storage.local
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [PERSONAS_STORAGE_KEY]: current });
    }
  }
}

export async function deleteCustomPersona(id: string): Promise<void> {
  const current = await loadCustomPersonas();
  const filtered = current.filter((p) => p.id !== id);
  const storage = getStorageArea();
  await storage.set({ [PERSONAS_STORAGE_KEY]: filtered });
}

export async function resolveRespondent(id: string): Promise<RespondentProfile> {
  // 1. Check presets first
  const preset = respondentPresets.find((p) => p.id === id);
  if (preset) {
    return buildRespondent(id);
  }

  // 2. Check custom personas
  const customs = await loadCustomPersonas();
  const custom = customs.find((p) => p.id === id);
  if (custom) {
    return customPersonaToProfile(custom);
  }

  throw new Error(`Unknown respondent preset or custom persona ID: "${id}"`);
}
