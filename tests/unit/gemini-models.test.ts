import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MODEL,
  GeminiError,
  listAvailableModels,
  normalizeModelId,
  verifyKey,
  type GeminiModelInfo,
} from '@/ai/gemini';
import {
  loadCachedModels,
  loadSelectedModel,
  pickBestDefaultModel,
  saveCachedModels,
  saveSelectedModel,
} from '@/storage/model';

describe('Gemini Model Discovery & Selection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeModelId', () => {
    it('strips "models/" prefix from full resource names', () => {
      expect(normalizeModelId('models/gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelId('models/gemini-1.5-pro')).toBe('gemini-1.5-pro');
    });

    it('preserves clean model ids and trims whitespace', () => {
      expect(normalizeModelId('gemini-2.0-flash')).toBe('gemini-2.0-flash');
      expect(normalizeModelId('  gemini-2.5-flash  ')).toBe('gemini-2.5-flash');
    });
  });

  describe('pickBestDefaultModel', () => {
    it('selects the highest priority Flash model in the list', () => {
      const mockModels: GeminiModelInfo[] = [
        {
          id: 'gemini-1.5-pro',
          name: 'models/gemini-1.5-pro',
          displayName: 'Gemini 1.5 Pro',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          id: 'gemini-2.0-flash',
          name: 'models/gemini-2.0-flash',
          displayName: 'Gemini 2.0 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          id: 'gemini-1.5-flash',
          name: 'models/gemini-1.5-flash',
          displayName: 'Gemini 1.5 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ];

      expect(pickBestDefaultModel(mockModels)).toBe('gemini-2.0-flash');
    });

    it('prioritizes Gemini Flash models over Gemma or third-party models', () => {
      const mockModels: GeminiModelInfo[] = [
        {
          id: 'gemma-4-26b-a4b-it',
          name: 'models/gemma-4-26b-a4b-it',
          displayName: 'Gemma 4 26B A4B IT',
          supportedGenerationMethods: ['generateContent'],
        },
        {
          id: 'gemini-2.0-flash-001',
          name: 'models/gemini-2.0-flash-001',
          displayName: 'Gemini 2.0 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ];

      expect(pickBestDefaultModel(mockModels)).toBe('gemini-2.0-flash-001');
    });

    it('falls back to any model containing "flash" if priority list misses', () => {
      const mockModels: GeminiModelInfo[] = [
        {
          id: 'gemini-custom-flash-preview',
          name: 'models/gemini-custom-flash-preview',
          displayName: 'Custom Flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ];
      expect(pickBestDefaultModel(mockModels)).toBe('gemini-custom-flash-preview');
    });

    it('returns DEFAULT_MODEL when the model list is empty', () => {
      expect(pickBestDefaultModel([])).toBe(DEFAULT_MODEL);
    });
  });

  describe('listAvailableModels', () => {
    it('queries Google models endpoint and filters for generateContent models', async () => {
      const fakeApiResponse = {
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            description: 'Fast multimodal model',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Text Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/gemini-1.5-pro',
            displayName: 'Gemini 1.5 Pro',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeApiResponse,
      } as Response);

      const models = await listAvailableModels('test-api-key');

      expect(models).toHaveLength(2);
      expect(models[0]?.id).toBe('gemini-2.0-flash');
      expect(models[0]?.displayName).toBe('Gemini 2.0 Flash');
      expect(models[1]?.id).toBe('gemini-1.5-pro');
      expect(global.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models',
        expect.objectContaining({
          method: 'GET',
          headers: { 'x-goog-api-key': 'test-api-key' },
        }),
      );
    });

    it('throws GeminiError on HTTP failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'API key invalid',
      } as Response);

      await expect(listAvailableModels('invalid-key')).rejects.toThrow(GeminiError);
    });
  });

  describe('verifyKey', () => {
    it('returns valid: true and model list on success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            {
              name: 'models/gemini-2.0-flash',
              displayName: 'Gemini 2.0 Flash',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
        }),
      } as Response);

      const res = await verifyKey('valid-key');
      expect(res.valid).toBe(true);
      expect(res.models).toHaveLength(1);
      expect(res.models[0]?.id).toBe('gemini-2.0-flash');
    });

    it('returns valid: false and error message on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'API key not found',
      } as Response);

      const res = await verifyKey('bad-key');
      expect(res.valid).toBe(false);
      expect(res.models).toHaveLength(0);
      expect(res.error).toBeDefined();
    });

    it('returns valid: false if connection times out or aborts', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        const err = new DOMException('The user aborted a request.', 'AbortError');
        return Promise.reject(err);
      });

      const res = await verifyKey('timeout-key');
      expect(res.valid).toBe(false);
      expect(res.models).toHaveLength(0);
      expect(res.error).toBeDefined();
    });
  });

  describe('Model Storage', () => {
    it('saves and loads selected model', async () => {
      await saveSelectedModel('gemini-1.5-flash');
      const loaded = await loadSelectedModel();
      expect(loaded).toBe('gemini-1.5-flash');
    });

    it('caches and retrieves available models list', async () => {
      const mockList: GeminiModelInfo[] = [
        {
          id: 'gemini-2.0-flash',
          name: 'models/gemini-2.0-flash',
          displayName: 'Gemini 2.0 Flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ];

      await saveCachedModels(mockList);
      const cached = await loadCachedModels();
      expect(cached).toHaveLength(1);
      expect(cached[0]?.id).toBe('gemini-2.0-flash');
    });
  });
});
