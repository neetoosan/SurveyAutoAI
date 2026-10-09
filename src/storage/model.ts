import { DEFAULT_MODEL, type GeminiModelInfo, normalizeModelId } from '@/ai/gemini';

const SELECTED_MODEL_KEY = 'saqa.selectedModel';
const CACHED_MODELS_KEY = 'saqa.availableModels';

export const PREFERRED_MODELS_ORDER = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-pro',
  'gemini-1.5-pro',
];

/**
 * Intelligent model selector: picks the best available Flash model for
 * sub-second survey response times, falling back smoothly across available models.
 */
export function pickBestDefaultModel(models: GeminiModelInfo[]): string {
  if (!models || models.length === 0) return DEFAULT_MODEL;

  for (const preferred of PREFERRED_MODELS_ORDER) {
    const match = models.find((m) => m.id.toLowerCase() === preferred.toLowerCase());
    if (match) return match.id;
  }

  // Fallback to any model containing "flash"
  const anyFlash = models.find((m) => m.id.toLowerCase().includes('flash'));
  if (anyFlash) return anyFlash.id;

  // Final fallback to the first available generative model
  return models[0]?.id ?? DEFAULT_MODEL;
}

// In-memory fallback for test environments without chrome.storage
const memoryStore: Record<string, unknown> = {};

function getStorageArea(): {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
} {
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    return chrome.storage.sync;
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    return chrome.storage.local;
  }
  return {
    async get(key: string) {
      return { [key]: memoryStore[key] };
    },
    async set(items: Record<string, unknown>) {
      Object.assign(memoryStore, items);
    },
  };
}

/**
 * Loads the user's explicitly selected model, checking sync storage
 * with local storage fallback, and defaulting to DEFAULT_MODEL.
 */
export async function loadSelectedModel(): Promise<string> {
  try {
    const area = getStorageArea();
    const res = await area.get(SELECTED_MODEL_KEY);
    const val = res[SELECTED_MODEL_KEY] as string | undefined;
    if (val) return normalizeModelId(val);
  } catch {
    // Fallback if storage is temporarily unavailable
  }
  return DEFAULT_MODEL;
}

/**
 * Saves the user's selected model across sync and local storage.
 */
export async function saveSelectedModel(model: string): Promise<void> {
  const normalized = normalizeModelId(model);
  const area = getStorageArea();
  await area.set({ [SELECTED_MODEL_KEY]: normalized });
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: normalized });
    } catch {
      // Ignore
    }
  }
}

/**
 * Loads cached models discovered from the operator's API key.
 */
export async function loadCachedModels(): Promise<GeminiModelInfo[]> {
  try {
    const area = getStorageArea();
    const res = await area.get(CACHED_MODELS_KEY);
    return (res[CACHED_MODELS_KEY] as GeminiModelInfo[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Caches discovered models from the operator's API key in local storage.
 */
export async function saveCachedModels(models: GeminiModelInfo[]): Promise<void> {
  const area = getStorageArea();
  await area.set({ [CACHED_MODELS_KEY]: models });
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({ [CACHED_MODELS_KEY]: models });
    } catch {
      // Ignore
    }
  }
}
