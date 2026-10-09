import { plannedAnswersResponseSchema } from './schema';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Default model. Google renames preview models fairly often, so this is
 * overridable from the side panel rather than hard-coded at the call site.
 */
export const DEFAULT_MODEL = 'gemini-2.0-flash';

export interface GeminiModelInfo {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods: string[];
}

export function normalizeModelId(model: string): string {
  return model.replace(/^models\//, '').trim();
}

export interface GeminiUsage {
  promptTokens: number;
  responseTokens: number;
}

export interface GeminiResult<T> {
  data: T;
  usage: GeminiUsage;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

interface GenerateOptions {
  apiKey: string;
  model?: string;
  prompt: string;
  systemInstruction?: string;
  /** Overrides the default planned-answers schema when a caller needs another shape. */
  responseSchema?: unknown;
  signal?: AbortSignal;
  maxAttempts?: number;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Exponential backoff with full jitter. Jitter here is about not stampeding
 * the API after a 429 -- it has nothing to do with how fills are timed.
 */
function backoffDelay(attempt: number): number {
  const ceiling = Math.min(30_000, 500 * 2 ** attempt);
  return Math.random() * ceiling;
}

export async function generateStructured<T>(options: GenerateOptions): Promise<GeminiResult<T>> {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    prompt,
    systemInstruction,
    responseSchema = plannedAnswersResponseSchema,
    signal,
    maxAttempts = 4,
  } = options;

  if (!apiKey) throw new GeminiError('No Gemini API key configured.');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.4,
    },
  };

  let lastError: GeminiError | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(backoffDelay(attempt), signal);

    let response: Response;
    try {
      const normalizedModel = normalizeModelId(model || DEFAULT_MODEL);
      response = await fetch(`${API_ROOT}/${normalizedModel}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = new GeminiError(`Network failure: ${String(error)}`, undefined, true);
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      const retryable = RETRYABLE_STATUSES.has(response.status);
      lastError = new GeminiError(
        `Gemini returned ${response.status}: ${detail.slice(0, 400)}`,
        response.status,
        retryable,
      );
      if (!retryable) throw lastError;
      continue;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      promptFeedback?: { blockReason?: string };
    };

    if (payload.promptFeedback?.blockReason) {
      throw new GeminiError(`Request blocked: ${payload.promptFeedback.blockReason}`);
    }

    const candidate = payload.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    if (candidate?.finishReason === 'MAX_TOKENS') {
      // A truncated JSON body is unparseable; a smaller batch is the fix.
      throw new GeminiError(
        'Response truncated at the token limit. Reduce the question batch size.',
      );
    }
    if (!text) {
      lastError = new GeminiError('Gemini returned an empty candidate.', undefined, true);
      continue;
    }

    try {
      return {
        data: JSON.parse(text) as T,
        usage: {
          promptTokens: payload.usageMetadata?.promptTokenCount ?? 0,
          responseTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch {
      lastError = new GeminiError(`Structured output was not valid JSON: ${text.slice(0, 200)}`);
      throw lastError;
    }
  }

  throw lastError ?? new GeminiError('Exhausted retries with no response.');
}

/**
 * Dynamically queries Google Generative Language API for all active models
 * enabled on the operator's specific API key that support generateContent.
 * Enforces an 8-second timeout to prevent UI freezes on stalled sockets.
 */
export async function listAvailableModels(
  apiKey: string,
  signal?: AbortSignal,
): Promise<GeminiModelInfo[]> {
  if (!apiKey) throw new GeminiError('No Gemini API key provided.');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('Connection to Google AI Studio timed out after 8s. Check your network.'));
  }, 8000);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(API_ROOT, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new GeminiError('Connection to Google AI Studio timed out after 8s. Check your network.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new GeminiError(
      `Gemini models endpoint returned ${response.status}: ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    models?: Array<{
      name: string;
      displayName?: string;
      description?: string;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }>;
  };

  const rawModels = payload.models ?? [];
  return rawModels
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({
      id: normalizeModelId(m.name),
      name: m.name,
      displayName: m.displayName || normalizeModelId(m.name),
      description: m.description,
      inputTokenLimit: m.inputTokenLimit,
      outputTokenLimit: m.outputTokenLimit,
      supportedGenerationMethods: m.supportedGenerationMethods ?? [],
    }))
    .sort((a, b) => {
      // Prioritize fast Gemini Flash models, then Gemini Pro, then other models
      const score = (id: string) => {
        const lower = id.toLowerCase();
        if (lower.includes('gemini-2.5-flash')) return 100;
        if (lower.includes('gemini-2.0-flash')) return 95;
        if (lower.includes('gemini-1.5-flash')) return 90;
        if (lower.includes('gemini') && lower.includes('flash')) return 85;
        if (lower.includes('gemini-2.5-pro')) return 80;
        if (lower.includes('gemini-2.0-pro')) return 75;
        if (lower.includes('gemini-1.5-pro')) return 70;
        if (lower.includes('gemini')) return 60;
        if (lower.includes('flash')) return 50;
        return 10;
      };
      return score(b.id) - score(a.id);
    });
}

export interface VerifyKeyResult {
  valid: boolean;
  models: GeminiModelInfo[];
  error?: string;
}

/**
 * Comprehensive credential and model discovery check. Queries the live models endpoint
 * rather than hardcoding a fragile model string that Google may rename or deprecate.
 */
export async function verifyKey(apiKey: string, signal?: AbortSignal): Promise<VerifyKeyResult> {
  try {
    const models = await listAvailableModels(apiKey, signal);
    return { valid: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, models: [], error: message };
  }
}
