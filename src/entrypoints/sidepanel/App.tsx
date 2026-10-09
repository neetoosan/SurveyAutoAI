import { useEffect, useRef, useState } from 'react';
import type { BackgroundEvent, SessionState } from '@/types/messages';
import { usePanelStore } from '@/storage/store';
import { call } from '@/lib/rpc';
import { respondentPresets } from '@/ai/respondents';
import {
  attest,
  listAttestations,
  requestHostAccess,
  revoke,
  type OwnershipAttestation,
} from '@/ownership/guard';
import {
  clearKey,
  getKey,
  getVaultMode,
  storeKey,
  unlock,
  type VaultMode,
} from '@/storage/vault';
import {
  loadCustomPersonas,
  saveCustomPersona,
  deleteCustomPersona,
  type CustomPersona,
} from '@/storage/personas';
import type { PlannedAnswer } from '@/types/respondent';
import type { SurveyQuestion } from '@/types/survey';
import {
  verifyKey,
  listAvailableModels,
  type GeminiModelInfo,
  DEFAULT_MODEL,
  normalizeModelId,
} from '@/ai/gemini';
import {
  loadSelectedModel,
  saveSelectedModel,
  loadCachedModels,
  saveCachedModels,
  pickBestDefaultModel,
} from '@/storage/model';
import { playTripwireChime } from '@/dom/audio';
import { Badge, Button, Callout, Field, inputClass, Section } from './components';

export function App() {
  const store = usePanelStore();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const listener = (event: BackgroundEvent) => {
      if (event.type === 'LOG') store.appendLog(event.payload);
      if (event.type === 'STATE') {
        const prevPhase = store.phase;
        store.applyState(event.payload);
        if (event.payload.phase === 'paused' && prevPhase !== 'paused' && store.soundEnabled) {
          playTripwireChime();
        }
      }
      if (event.type === 'TOKENS') store.setTokens(event.payload);
      if (event.type === 'TRIPWIRE') {
        if (store.soundEnabled) playTripwireChime();
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    call<{ state: SessionState; tokens: typeof store.tokens }>({ type: 'GET_STATE_REQUEST' })
      .then(({ state, tokens }) => {
        store.applyState(state);
        store.setTokens(tokens);
      })
      .catch(() => {});

    return () => chrome.runtime.onMessage.removeListener(listener);
    // The store's actions are stable; re-subscribing on every render is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    try {
      await action();
    } catch (error) {
      store.appendLog({
        level: 'error',
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <Header />
      <TripwireBanner busy={busy} run={run} />
      <div className="flex-1 overflow-y-auto">
        <VaultCard />
        <OwnershipCard />
        <PersonaCard busy={busy} run={run} />
        <ScanCard busy={busy} run={run} />
        <PlanCard busy={busy} run={run} />
        <ExportCard busy={busy} run={run} />
        <LogCard />
      </div>
      <Footer />
    </div>
  );
}

function Header() {
  const { phase, schema, lastError } = usePanelStore();
  const tone =
    phase === 'error'
      ? 'red'
      : phase === 'paused'
        ? 'amber'
        : phase === 'complete'
          ? 'green'
          : phase === 'idle'
            ? 'slate'
            : 'sky';

  return (
    <header className="border-b border-slate-800 bg-slate-900 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <h1 className="text-xs font-semibold tracking-tight text-slate-100">
          SurveyAutoAI <span className="text-slate-500">Autonomous Assistant</span>
        </h1>
        <Badge tone={tone}>{phase}</Badge>
      </div>
      {schema ? (
        <p className="mt-1 truncate text-[11px] text-slate-400">
          {schema.platform} &middot; {schema.page.questions.length} question(s) &middot;{' '}
          <span className="text-slate-500">{schema.title}</span>
        </p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">Nothing scanned yet.</p>
      )}
      {lastError && phase === 'error' && (
        <p className="mt-1.5 text-[11px] leading-snug text-red-300">{lastError}</p>
      )}
    </header>
  );
}

function TripwireBanner({
  run,
  busy,
}: {
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
  busy: string | null;
}) {
  const { tripwire, phase, soundEnabled, setSoundEnabled } = usePanelStore();
  if (phase !== 'paused' && !tripwire) return null;

  return (
    <div className="border-b border-amber-600 bg-amber-950/90 px-3 py-2.5 text-amber-100">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⚠️</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-200">
            Bot Challenge Detected
          </span>
        </div>
        <button
          type="button"
          className="text-[10px] text-amber-300 underline hover:text-amber-100"
          onClick={() => setSoundEnabled(!soundEnabled)}
        >
          {soundEnabled ? '🔔 Alert sound on' : '🔕 Muted'}
        </button>
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-amber-200">
        {tripwire?.description ?? 'CAPTCHA / Cloudflare challenge triggered on the page'}. Automated
        execution has been paused to protect your survey session.
      </p>

      <p className="mt-1 text-[10px] text-amber-300/80">
        Please complete the verification challenge directly in the survey tab, then click Resume below.
      </p>

      <div className="mt-2.5 flex items-center gap-2">
        <Button
          variant="primary"
          disabled={busy !== null}
          onClick={() => run('resume', () => call({ type: 'RESUME_REQUEST' }))}
        >
          {busy === 'resume' ? 'Resuming...' : '✓ I solved it, resume'}
        </Button>
        <Button
          variant="default"
          disabled={busy !== null}
          onClick={() => run('recheck', () => call({ type: 'CHECK_TRIPWIRE_REQUEST' }))}
        >
          Re-check page
        </Button>
      </div>
    </div>
  );
}

function VaultCard() {
  const [mode, setMode] = useState<VaultMode | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Model selection state
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [availableModels, setAvailableModels] = useState<GeminiModelInfo[]>([]);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');
  const [refreshingModels, setRefreshingModels] = useState(false);

  useEffect(() => {
    getVaultMode().then(setMode);
    loadSelectedModel().then((m) => {
      setSelectedModel(m);
      setCustomModelInput(m);
    });
    loadCachedModels().then((cached) => {
      if (cached && cached.length > 0) {
        setAvailableModels(cached);
      }
    });
  }, []);

  async function handleModelChange(modelId: string) {
    if (modelId === '__custom__') {
      setIsCustomModel(true);
      return;
    }
    setIsCustomModel(false);
    setSelectedModel(modelId);
    setCustomModelInput(modelId);
    await saveSelectedModel(modelId);
    setStatus(`Active model updated: ${modelId}`);
  }

  async function handleCustomModelSave() {
    if (!customModelInput.trim()) return;
    const normalized = normalizeModelId(customModelInput);
    setSelectedModel(normalized);
    await saveSelectedModel(normalized);
    setStatus(`Active custom model: ${normalized}`);
  }

  async function refreshModelsFromKey() {
    setRefreshingModels(true);
    setStatus('Querying Google AI Studio for active models...');
    try {
      const key = await getKey();
      if (!key) {
        setStatus('Please unlock your vault first to refresh models.');
        setRefreshingModels(false);
        return;
      }
      const models = await listAvailableModels(key);
      if (models.length === 0) {
        setStatus('No generateContent models found on this key.');
      } else {
        setAvailableModels(models);
        await saveCachedModels(models);
        const exists = models.some((m) => m.id === selectedModel);
        if (!exists && !isCustomModel) {
          const best = pickBestDefaultModel(models);
          setSelectedModel(best);
          await saveSelectedModel(best);
          setStatus(`Loaded ${models.length} models. Switched to recommended: ${best}`);
        } else {
          setStatus(`Loaded ${models.length} available models from Google AI Studio.`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Failed to refresh models: ${msg}`);
    } finally {
      setRefreshingModels(false);
    }
  }

  async function verifyAndLoadKeyModels() {
    if (!apiKey.trim()) return setStatus('Enter an API key first.');
    setIsVerifying(true);
    setStatus('Connecting to Google AI Studio & discovering models...');
    try {
      const result = await verifyKey(apiKey.trim());
      if (!result.valid) {
        setStatus(`Key verification failed: ${result.error || 'Invalid API key.'}`);
        return;
      }
      if (result.models.length > 0) {
        setAvailableModels(result.models);
        await saveCachedModels(result.models);
        const best = pickBestDefaultModel(result.models);
        setSelectedModel(best);
        setCustomModelInput(best);
        setStatus(`Key verified! Found ${result.models.length} active models. Recommended: ${best}`);
      } else {
        setStatus('Key valid, but Google returned 0 text generation models.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Verification error: ${msg}`);
    } finally {
      setIsVerifying(false);
    }
  }

  async function save() {
    if (!apiKey.trim()) return setStatus('Enter a key first.');
    setIsSaving(true);
    setStatus('Saving...');
    try {
      let currentModels = availableModels;
      // Only run network verification if models have not yet been discovered
      if (currentModels.length === 0) {
        setStatus('Verifying key with Google AI Studio...');
        const result = await verifyKey(apiKey.trim());
        if (!result.valid) {
          setStatus(`Key rejected by Google Gemini API: ${result.error || 'Not saved.'}`);
          return;
        }
        currentModels = result.models;
        if (result.models.length > 0) {
          setAvailableModels(result.models);
          await saveCachedModels(result.models);
        }
      }

      setStatus('Saving key & model configuration...');
      const chosenModel = isCustomModel ? normalizeModelId(customModelInput) : selectedModel;
      await saveSelectedModel(chosenModel);

      if (usePassphrase && !passphrase.trim()) {
        setStatus('Please enter a passphrase to encrypt your key, or uncheck passphrase encryption.');
        return;
      }

      const saved = await storeKey(
        apiKey.trim(),
        usePassphrase && passphrase.trim() ? { passphrase: passphrase.trim() } : {},
      );
      setMode(saved);
      setApiKey('');
      setPassphrase('');
      setStatus(`Saved in ${saved} mode. Active model: ${chosenModel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error saving key: ${msg}`);
    } finally {
      setIsSaving(false);
    }
  }

  if (mode) {
    return (
      <Section
        title="Gemini API key & Model"
        subtitle={
          mode === 'passphrase'
            ? 'Encrypted at rest. Unlock once per browser session.'
            : 'Stored unencrypted in extension storage.'
        }
        right={<Badge tone={mode === 'passphrase' ? 'green' : 'amber'}>{mode}</Badge>}
      >
        {mode === 'passphrase' && (
          <div className="mb-2 flex gap-1.5">
            <input
              type="password"
              className={inputClass}
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
            <Button
              onClick={() =>
                unlock(passphrase)
                  .then(() => setStatus('Unlocked.'))
                  .catch((e: Error) => setStatus(e.message))
              }
            >
              Unlock
            </Button>
          </div>
        )}

        {/* AI Model Selector */}
        <div className="mt-2 mb-2 p-2.5 rounded-md bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
              <span>🤖</span> Active AI Model
            </span>
            <button
              type="button"
              disabled={refreshingModels}
              onClick={refreshModelsFromKey}
              className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1 disabled:opacity-50"
              title="Query Google for live models active on your key"
            >
              <span>{refreshingModels ? '⏳' : '🔄'}</span>
              <span>{refreshingModels ? 'Checking...' : 'Refresh models'}</span>
            </button>
          </div>

          {!isCustomModel ? (
            <select
              className={inputClass}
              value={selectedModel}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {availableModels.length > 0 ? (
                availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.id}) {m.id.includes('flash') ? '⚡' : ''}
                  </option>
                ))
              ) : (
                <>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Recommended)</option>
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                </>
              )}
              <option value="__custom__">⚙️ Custom model name...</option>
            </select>
          ) : (
            <div className="flex gap-1.5">
              <input
                type="text"
                className={inputClass}
                placeholder="e.g. gemini-2.0-flash"
                value={customModelInput}
                onChange={(e) => setCustomModelInput(e.target.value)}
              />
              <Button variant="primary" onClick={handleCustomModelSave}>
                Save
              </Button>
              <Button variant="ghost" onClick={() => setIsCustomModel(false)}>
                Cancel
              </Button>
            </div>
          )}

          <p className="text-[10px] text-slate-400 leading-relaxed">
            {availableModels.find((m) => m.id === selectedModel)?.description ||
              'Fast sub-second Flash models are strongly recommended for natural survey responses.'}
          </p>
        </div>

        <Button
          variant="ghost"
          onClick={() =>
            clearKey().then(() => {
              setMode(null);
              setStatus('Key cleared.');
            })
          }
        >
          Replace key
        </Button>
        {status && <p className="mt-1 text-[11px] text-slate-400">{status}</p>}
      </Section>
    );
  }

  return (
    <Section
      title="Gemini API key & Model"
      subtitle="Enter your key from Google AI Studio. We'll discover active models automatically."
    >
      <div className="space-y-2.5">
        <Field label="API key">
          <input
            type="password"
            className={inputClass}
            placeholder="AIzaSy..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </Field>

        {availableModels.length > 0 && (
          <Field label="Select AI Model" hint="Discovered automatically from your API key.">
            {!isCustomModel ? (
              <select
                className={inputClass}
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.id}) {m.id.includes('flash') ? '⚡' : ''}
                  </option>
                ))}
                <option value="__custom__">⚙️ Custom model name...</option>
              </select>
            ) : (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. gemini-2.0-flash"
                  value={customModelInput}
                  onChange={(e) => setCustomModelInput(e.target.value)}
                />
                <Button variant="ghost" onClick={() => setIsCustomModel(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </Field>
        )}

        <label className="flex items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={usePassphrase}
            onChange={(e) => setUsePassphrase(e.target.checked)}
          />
          Encrypt with a passphrase (recommended)
        </label>

        {usePassphrase && (
          <Field
            label="Passphrase"
            hint="Derives an AES-GCM key with PBKDF2 (310k iterations). We never store this."
          >
            <input
              type="password"
              className={inputClass}
              placeholder="Choose a passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>
        )}

        <div className="flex gap-2 pt-1">
          {availableModels.length === 0 ? (
            <Button
              variant="primary"
              disabled={isVerifying || isSaving}
              onClick={verifyAndLoadKeyModels}
            >
              {isVerifying ? 'Verifying...' : 'Verify & Discover Models'}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={isSaving || isVerifying}
                onClick={save}
              >
                {isSaving ? 'Saving...' : 'Save Key & Model'}
              </Button>
              <Button
                variant="ghost"
                disabled={isSaving || isVerifying}
                onClick={verifyAndLoadKeyModels}
              >
                {isVerifying ? 'Checking...' : 'Re-check Models'}
              </Button>
            </>
          )}
        </div>
        {status && <p className="text-[11px] text-slate-400">{status}</p>}
      </div>
    </Section>
  );
}

function OwnershipCard() {
  const [tab, setTab] = useState<{
    url?: string;
    title?: string;
    key: string;
    granted: boolean;
  } | null>(null);
  const [records, setRecords] = useState<OwnershipAttestation[]>([]);
  const [basis, setBasis] = useState<OwnershipAttestation['basis']>('owner');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function refresh() {
    const active = await call<NonNullable<typeof tab>>({ type: 'GET_ACTIVE_TAB_REQUEST' }).catch(
      () => null,
    );
    setTab(active);
    setRecords(await listAttestations());
  }

  useEffect(() => {
    refresh();
  }, []);

  const key = tab?.key ?? '';
  const record = records.find((r) => r.origin === key);
  const registered = Boolean(record && tab?.granted);

  async function register() {
    let targetKey = key;
    if (!targetKey || targetKey.startsWith('chrome-extension://')) {
      const active = await call<NonNullable<typeof tab>>({ type: 'GET_ACTIVE_TAB_REQUEST' }).catch(
        () => null,
      );
      if (active?.key) {
        setTab(active);
        targetKey = active.key;
      }
    }
    if (!targetKey || targetKey.startsWith('chrome-extension://')) return;
    setStatus('Requesting host permission...');
    const granted = await requestHostAccess(targetKey).catch(() => false);
    if (!granted) {
      setStatus('Permission refused by user.');
      return;
    }
    await attest(targetKey, basis, note || undefined);
    setStatus('Registered.');
    await refresh();
  }

  return (
    <Section
      title="Target form"
      subtitle="Permissions are scoped to registered forms."
      right={
        registered ? (
          <Badge tone="green">registered</Badge>
        ) : tab ? (
          <Badge tone="amber">unregistered</Badge>
        ) : null
      }
    >
      {tab && registered && (
        <div className="space-y-1 text-[11px] text-slate-300">
          <p className="truncate font-mono text-[10px] text-slate-400">{record!.origin}</p>
          <p className="text-slate-400">
            Basis: <span className="text-slate-200">{record!.basis}</span>
            {record!.note && (
              <>
                {' '}
                &middot; <span className="italic text-slate-400">{record!.note}</span>
              </>
            )}
          </p>
          <Button
            variant="ghost"
            onClick={() => revoke(record!.origin).then(refresh)}
          >
            Revoke access
          </Button>
        </div>
      )}

      {tab && !registered && (
        <div className="space-y-2">
          <Callout tone="warn">
            Register this form to let the harness read and fill it. Use this on forms you built or
            administer &mdash; not on someone else&rsquo;s live survey.
          </Callout>
          <p className="break-all font-mono text-[10px] text-slate-400">{key}</p>
          <Field label="Basis">
            <select
              className={inputClass}
              value={basis}
              onChange={(e) => setBasis(e.target.value as OwnershipAttestation['basis'])}
            >
              <option value="owner">I own this form</option>
              <option value="administrator">I administer it for my organization</option>
              <option value="written-permission">I have written permission to test it</option>
            </select>
          </Field>
          <Field label="Note (optional)">
            <input
              className={inputClass}
              placeholder="e.g. Q3 onboarding survey, ticket QA-412"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Button variant="primary" onClick={register}>
            Register this form
          </Button>
        </div>
      )}

      {status && <p className="mt-1.5 text-[11px] text-slate-400">{status}</p>}
    </Section>
  );
}

function ScanCard({
  busy,
  run,
}: {
  busy: string | null;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const { schema } = usePanelStore();

  return (
    <Section title="1. Scan" subtitle="Reads the page structure. Never modifies it.">
      <Button
        variant="primary"
        disabled={busy !== null}
        onClick={() => run('scan', () => call({ type: 'SCAN_PAGE_REQUEST' }))}
      >
        {busy === 'scan' ? 'Scanning...' : 'Scan page'}
      </Button>

      {schema && (
        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
          {schema.page.questions.map((q) => (
            <li key={q.id} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span className="mt-0.5 shrink-0 font-mono text-[9px] text-slate-600">
                {String(q.index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-slate-300">{q.label || '(unlabeled)'}</span>{' '}
                <span className="text-slate-600">
                  {q.type}
                  {q.required && ' *'}
                  {q.options && ` (${q.options.length})`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {schema && schema.skipped.length > 0 && (
        <p className="mt-2 text-[10px] text-slate-500">
          {schema.skipped.length} element(s) skipped and reported, not filled.
        </p>
      )}
    </Section>
  );
}

function PersonaCard({
  busy: _busy,
  run: _run,
}: {
  busy: string | null;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const { selectedPersonaId, setSelectedPersonaId, run: activeRun } = usePanelStore();
  const [customPersonas, setCustomPersonas] = useState<CustomPersona[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<CustomPersona | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formProfession, setFormProfession] = useState('');
  const [formAge, setFormAge] = useState('');
  const [formIncome, setFormIncome] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formTech, setFormTech] = useState<'low' | 'moderate' | 'high' | 'expert'>('high');
  const [formBiases, setFormBiases] = useState('');
  const [formTone, setFormTone] = useState('');
  const [formLength, setFormLength] = useState<'terse' | 'moderate' | 'verbose'>('moderate');
  const [formInstructions, setFormInstructions] = useState('');

  const refreshPersonas = () => {
    loadCustomPersonas().then(setCustomPersonas).catch(() => {});
  };

  useEffect(() => {
    refreshPersonas();
  }, []);

  const openNewBuilder = () => {
    setEditingPersona(null);
    setFormName('');
    setFormDesc('');
    setFormProfession('');
    setFormAge('');
    setFormIncome('');
    setFormLocation('');
    setFormTech('high');
    setFormBiases('');
    setFormTone('');
    setFormLength('moderate');
    setFormInstructions('');
    setBuilderOpen(true);
  };

  const openEditBuilder = (persona: CustomPersona) => {
    setEditingPersona(persona);
    setFormName(persona.name);
    setFormDesc(persona.description ?? '');
    setFormProfession(persona.demographics.profession ?? '');
    setFormAge(persona.demographics.age != null ? String(persona.demographics.age) : '');
    setFormIncome(persona.demographics.income ?? '');
    setFormLocation(persona.demographics.location ?? '');
    setFormTech(persona.demographics.techProficiency ?? 'high');
    setFormBiases(persona.biasesAndPreferences?.join('\n') ?? '');
    setFormTone(persona.communicationStyle.tone ?? '');
    setFormLength(persona.communicationStyle.length ?? 'moderate');
    setFormInstructions(persona.communicationStyle.customInstructions ?? '');
    setBuilderOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) return;
    const biases = formBiases
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);

    const persona: CustomPersona = {
      id: editingPersona ? editingPersona.id : `custom-${Date.now().toString(36)}`,
      name: formName.trim(),
      description: formDesc.trim() || undefined,
      demographics: {
        profession: formProfession.trim() || undefined,
        age: formAge ? Number(formAge) || formAge : undefined,
        income: formIncome.trim() || undefined,
        location: formLocation.trim() || undefined,
        techProficiency: formTech,
      },
      biasesAndPreferences: biases,
      communicationStyle: {
        tone: formTone.trim() || undefined,
        length: formLength,
        customInstructions: formInstructions.trim() || undefined,
      },
      createdAt: editingPersona ? editingPersona.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    await saveCustomPersona(persona);
    refreshPersonas();
    setSelectedPersonaId(persona.id);
    setBuilderOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteCustomPersona(id);
    refreshPersonas();
    if (selectedPersonaId === id) {
      setSelectedPersonaId(respondentPresets[0]!.id);
    }
  };

  const currentPreset = respondentPresets.find((p) => p.id === selectedPersonaId);
  const currentCustom = customPersonas.find((p) => p.id === selectedPersonaId);
  const memoryCount = activeRun?.answers?.length ?? 0;

  return (
    <Section
      title="Persona & Memory"
      subtitle="Configure test persona traits and review cross-page session memory."
      right={
        memoryCount > 0 ? (
          <Badge tone="sky">🧠 {memoryCount} remembered</Badge>
        ) : (
          <Badge tone="slate">page 1</Badge>
        )
      }
    >
      <div className="space-y-2">
        <Field label="Active Persona">
          <select
            className={inputClass}
            value={selectedPersonaId}
            onChange={(e) => setSelectedPersonaId(e.target.value)}
          >
            <optgroup label="Preset Personas">
              {respondentPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            {customPersonas.length > 0 && (
              <optgroup label="Custom Personas">
                {customPersonas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.demographics.profession ? `(${c.demographics.profession})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>

        {currentPreset && (
          <p className="text-[11px] text-slate-400 italic leading-snug">
            {currentPreset.description}
          </p>
        )}

        {currentCustom && (
          <div className="rounded bg-slate-900/80 border border-slate-800 p-2 text-[11px] text-slate-300 space-y-1">
            <div className="flex justify-between items-start">
              <span className="font-semibold text-slate-200">{currentCustom.name}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-[10px] text-sky-400 hover:text-sky-300 underline"
                  onClick={() => openEditBuilder(currentCustom)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-[10px] text-red-400 hover:text-red-300 underline"
                  onClick={() => handleDelete(currentCustom.id)}
                >
                  Delete
                </button>
              </div>
            </div>
            {currentCustom.description && <p className="text-slate-400">{currentCustom.description}</p>}
            <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-2 pt-0.5">
              {currentCustom.demographics.profession && <span>💼 {currentCustom.demographics.profession}</span>}
              {currentCustom.demographics.location && <span>📍 {currentCustom.demographics.location}</span>}
              {currentCustom.demographics.techProficiency && <span>💻 {currentCustom.demographics.techProficiency}</span>}
            </div>
          </div>
        )}

        {!builderOpen ? (
          <Button
            variant="ghost"
            className="w-full border border-dashed border-slate-800 text-slate-400 hover:text-slate-200 text-xs py-1"
            onClick={openNewBuilder}
          >
            + Create Custom Persona
          </Button>
        ) : (
          <div className="rounded-lg border border-sky-900/60 bg-slate-900/90 p-2.5 space-y-2 mt-2">
            <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
              <span className="text-xs font-semibold text-sky-300">
                {editingPersona ? 'Edit Custom Persona' : 'New Custom Persona'}
              </span>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-300"
                onClick={() => setBuilderOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Persona Name *">
                <input
                  className={inputClass}
                  placeholder="e.g. DevOps Lead Alex"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </Field>
              <Field label="Profession">
                <input
                  className={inputClass}
                  placeholder="e.g. Platform Engineer"
                  value={formProfession}
                  onChange={(e) => setFormProfession(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Field label="Age">
                <input
                  className={inputClass}
                  placeholder="e.g. 35"
                  value={formAge}
                  onChange={(e) => setFormAge(e.target.value)}
                />
              </Field>
              <Field label="Income">
                <input
                  className={inputClass}
                  placeholder="e.g. $120k"
                  value={formIncome}
                  onChange={(e) => setFormIncome(e.target.value)}
                />
              </Field>
              <Field label="Tech Level">
                <select
                  className={inputClass}
                  value={formTech}
                  onChange={(e) => setFormTech(e.target.value as typeof formTech)}
                >
                  <option value="low">Low</option>
                  <option value="moderate">Moderate</option>
                  <option value="high">High</option>
                  <option value="expert">Expert</option>
                </select>
              </Field>
            </div>

            <Field label="Location">
              <input
                className={inputClass}
                placeholder="e.g. Austin, TX, USA"
                value={formLocation}
                onChange={(e) => setFormLocation(e.target.value)}
              />
            </Field>

            <Field label="Core Biases & Preferences" hint="One preference per line">
              <textarea
                className={`${inputClass} h-14 resize-none`}
                placeholder="Prefers open-source solutions&#10;Privacy-conscious&#10;Highly price-sensitive"
                value={formBiases}
                onChange={(e) => setFormBiases(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Answer Length">
                <select
                  className={inputClass}
                  value={formLength}
                  onChange={(e) => setFormLength(e.target.value as typeof formLength)}
                >
                  <option value="terse">Terse (Concise)</option>
                  <option value="moderate">Moderate</option>
                  <option value="verbose">Verbose (Detailed)</option>
                </select>
              </Field>
              <Field label="Tone">
                <input
                  className={inputClass}
                  placeholder="e.g. technical, friendly"
                  value={formTone}
                  onChange={(e) => setFormTone(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Special Guidance / Prompt Directives">
              <input
                className={inputClass}
                placeholder="e.g. Prioritize security and privacy considerations"
                value={formInstructions}
                onChange={(e) => setFormInstructions(e.target.value)}
              />
            </Field>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" onClick={() => setBuilderOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!formName.trim()} onClick={handleSave}>
                Save Persona
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function PlanCard({
  busy,
  run,
}: {
  busy: string | null;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const {
    schema,
    plan,
    phase,
    emulationMode,
    setEmulationMode,
    selectedPersonaId,
    speedrunAutoSubmit,
    setSpeedrunAutoSubmit,
    updatePlanAnswer,
  } = usePanelStore();

  const [execMode, setExecMode] = useState<'supervised' | 'speedrun'>('supervised');

  return (
    <Section
      title="Plan & Execute"
      subtitle="Preview or fill page by page, or launch autonomous multi-page speedrun."
      right={
        phase === 'speedrun' ? (
          <Badge tone="sky">🚀 Speedrunning</Badge>
        ) : null
      }
    >
      <div className="space-y-3">
        {/* Execution Mode Tabs */}
        <div className="flex rounded border border-slate-800 bg-slate-900/60 p-0.5">
          <button
            type="button"
            className={`flex-1 rounded py-1 text-xs font-medium transition-colors ${
              execMode === 'supervised'
                ? 'bg-slate-800 text-sky-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setExecMode('supervised')}
          >
            🛡️ Supervised Review
          </button>
          <button
            type="button"
            className={`flex-1 rounded py-1 text-xs font-medium transition-colors ${
              execMode === 'speedrun'
                ? 'bg-slate-800 text-sky-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setExecMode('speedrun')}
          >
            🚀 Autonomous Speedrun
          </button>
        </div>

        {execMode === 'speedrun' ? (
          <div className="space-y-2.5 rounded-lg border border-slate-800 bg-slate-900/40 p-2.5">
            <p className="text-[11px] leading-relaxed text-slate-400">
              Autonomous Speedrun scans, plans, fills with stealth emulation, and advances through multi-page surveys automatically until completion.
            </p>

            <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-300">
              <input
                type="checkbox"
                checked={speedrunAutoSubmit}
                onChange={(e) => setSpeedrunAutoSubmit(e.target.checked)}
              />
              <span>Auto-submit final survey page when completed</span>
            </label>

            {phase === 'speedrun' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-sky-300">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-sky-400" />
                  Speedrun active &middot; navigating pages...
                </div>
                <Button
                  variant="danger"
                  className="w-full py-2 text-xs"
                  onClick={() => call({ type: 'STOP_SPEEDRUN_REQUEST' })}
                >
                  ⏹️ Stop Speedrun
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                className="w-full py-2 text-xs font-semibold"
                disabled={busy !== null}
                onClick={() =>
                  run('speedrun', () =>
                    call({
                      type: 'START_SPEEDRUN_REQUEST',
                      payload: { respondentId: selectedPersonaId, autoSubmit: speedrunAutoSubmit },
                    }),
                  )
                }
              >
                {busy === 'speedrun' ? 'Launching Speedrun...' : '🚀 Launch Autonomous Speedrun'}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Field
              label="Emulation profile"
              hint="Stealth mimics human typing variance (40-120ms Gaussian), mouse paths, and smooth scrolling."
            >
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    emulationMode === 'human'
                      ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => {
                    setEmulationMode('human');
                    call({ type: 'SET_EMULATION_MODE_REQUEST', payload: { mode: 'human' } }).catch(
                      () => {},
                    );
                  }}
                >
                  🛡️ Human Stealth
                </button>
                <button
                  type="button"
                  className={`flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    emulationMode === 'instant'
                      ? 'border-sky-500 bg-sky-950/60 text-sky-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => {
                    setEmulationMode('instant');
                    call({ type: 'SET_EMULATION_MODE_REQUEST', payload: { mode: 'instant' } }).catch(
                      () => {},
                    );
                  }}
                >
                  ⚡ Instant (Fast)
                </button>
              </div>
            </Field>

            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="primary"
                disabled={!schema || busy !== null}
                onClick={() =>
                  run('plan', () =>
                    call({
                      type: 'PLAN_ANSWERS_REQUEST',
                      payload: { schema: schema!, respondentId: selectedPersonaId },
                    }),
                  )
                }
              >
                {busy === 'plan' ? 'Planning...' : 'Plan answers'}
              </Button>

              <Button
                disabled={!plan?.length || busy !== null}
                onClick={() =>
                  run('preview', () =>
                    call({
                      type: 'FILL_PAGE_REQUEST',
                      payload: {
                        schema: schema!,
                        answers: plan!,
                        dryRun: true,
                        emulationMode,
                      },
                    }),
                  )
                }
              >
                Preview
              </Button>

              <Button
                disabled={!plan?.length || busy !== null}
                onClick={() =>
                  run('fill', () =>
                    call({
                      type: 'FILL_PAGE_REQUEST',
                      payload: {
                        schema: schema!,
                        answers: plan!,
                        dryRun: false,
                        emulationMode,
                      },
                    }),
                  )
                }
              >
                {busy === 'fill' ? 'Filling...' : 'Fill'}
              </Button>

              <Button
                variant="ghost"
                disabled={busy !== null}
                onClick={() => run('clear', () => call({ type: 'CLEAR_HIGHLIGHTS_REQUEST' }))}
              >
                Clear overlay
              </Button>
            </div>

            {/* Confidence & Rationale Inspector with Inline Editing */}
            {plan && plan.length > 0 && (
              <div className="space-y-2 border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-300">
                    Confidence & Rationale Inspector ({plan.length})
                  </span>
                  <span className="text-[10px] text-slate-500">Click to inspect / override</span>
                </div>
                <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {plan.map((answer) => (
                    <AnswerInspectorItem
                      key={answer.questionId}
                      answer={answer}
                      question={schema?.page.questions.find((q) => q.id === answer.questionId)}
                      onSaveOverride={(updated) => {
                        updatePlanAnswer(updated);
                        call({
                          type: 'UPDATE_PLANNED_ANSWER_REQUEST',
                          payload: { answer: updated },
                        }).catch(() => {});
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-1.5 border-t border-slate-800 pt-2">
              <Button
                disabled={busy !== null}
                onClick={() => run('advance', () => call({ type: 'ADVANCE_PAGE_REQUEST' }))}
              >
                Next page
              </Button>
              <SubmitButton busy={busy} run={run} />
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function AnswerInspectorItem({
  answer,
  question,
  onSaveOverride,
}: {
  answer: PlannedAnswer;
  question?: SurveyQuestion;
  onSaveOverride: (updated: PlannedAnswer) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [overrideText, setOverrideText] = useState(answer.textAnswer ?? '');
  const [overrideOptIndex, setOverrideOptIndex] = useState<number | null>(
    answer.selectedOptionIndex ?? null,
  );
  const [overrideMultiIndexes, setOverrideMultiIndexes] = useState<number[]>(
    answer.selectedOptionIndexes ?? [],
  );
  const [overrideLikert, setOverrideLikert] = useState<number | null>(
    answer.likertValue ?? null,
  );

  const formatAnswerSummary = () => {
    if (answer.textAnswer != null) return `"${answer.textAnswer}"`;
    if (answer.likertValue != null) return `Rating: ${answer.likertValue}`;
    if (answer.selectedOptionIndex != null) {
      return (
        question?.options?.[answer.selectedOptionIndex]?.label ??
        `Option ${answer.selectedOptionIndex + 1}`
      );
    }
    if (answer.selectedOptionIndexes && answer.selectedOptionIndexes.length > 0) {
      return answer.selectedOptionIndexes
        .map((i) => question?.options?.[i]?.label ?? `Option ${i + 1}`)
        .join(', ');
    }
    return '(no value)';
  };

  const handleApplyOverride = () => {
    const updated: PlannedAnswer = {
      ...answer,
      textAnswer:
        question?.type === 'text' || question?.type === 'textarea'
          ? overrideText
          : answer.textAnswer,
      selectedOptionIndex: overrideOptIndex,
      selectedOptionIndexes: overrideMultiIndexes,
      likertValue: overrideLikert,
      uncertain: false,
    };
    onSaveOverride(updated);
    setEditing(false);
  };

  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 overflow-hidden text-[11px]">
      <div
        className="flex items-start gap-1.5 p-2 cursor-pointer hover:bg-slate-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="shrink-0 text-slate-500 font-mono text-[9px] mt-0.5">
          {question ? String(question.index + 1).padStart(2, '0') : '#'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-200 font-medium truncate">
              {question?.label || answer.questionId}
            </span>
            {question && (
              <span className="rounded bg-slate-800 px-1 py-0.2 text-[9px] text-slate-400">
                {question.type}
              </span>
            )}
            {answer.uncertain && <Badge tone="red">uncertain</Badge>}
          </div>
          <div className="mt-0.5 text-sky-300 truncate text-[11px]">{formatAnswerSummary()}</div>
        </div>
        <span className="text-slate-500 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="p-2 pt-0 border-t border-slate-800/80 bg-slate-950/40 space-y-2 mt-1">
          {answer.rationale && (
            <div className="rounded bg-slate-900 p-1.5 text-[10px] text-slate-400 border border-slate-800/50">
              <span className="text-slate-500 font-semibold block mb-0.5">AI Rationale:</span>
              <p className="italic">{answer.rationale}</p>
            </div>
          )}

          {!editing ? (
            <div className="flex justify-end">
              <button
                type="button"
                className="text-[10px] text-sky-400 hover:text-sky-300 font-medium"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
              >
                ✏️ Override Answer
              </button>
            </div>
          ) : (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-semibold text-slate-300 block">
                Edit Answer Value:
              </span>
              {(question?.type === 'radio' || question?.type === 'dropdown') && question.options && (
                <select
                  className={inputClass}
                  value={overrideOptIndex ?? ''}
                  onChange={(e) =>
                    setOverrideOptIndex(e.target.value === '' ? null : Number(e.target.value))
                  }
                >
                  <option value="">(None)</option>
                  {question.options.map((opt: { label: string }, i: number) => (
                    <option key={i} value={i}>
                      {opt.label || `Option ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}

              {question?.type === 'checkbox' && question.options && (
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {question.options.map((opt: { label: string }, i: number) => {
                    const checked = overrideMultiIndexes.includes(i);
                    return (
                      <label
                        key={i}
                        className="flex items-center gap-1.5 text-[10px] text-slate-300 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setOverrideMultiIndexes([...overrideMultiIndexes, i]);
                            } else {
                              setOverrideMultiIndexes(
                                overrideMultiIndexes.filter((idx) => idx !== i),
                              );
                            }
                          }}
                        />
                        <span>{opt.label || `Option ${i + 1}`}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {(question?.type === 'text' || question?.type === 'textarea' || !question) && (
                <input
                  className={inputClass}
                  value={overrideText}
                  onChange={(e) => setOverrideText(e.target.value)}
                  placeholder="Enter custom answer text"
                />
              )}

              {question?.type === 'likert' && (
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      className={`flex-1 rounded border py-1 text-xs font-semibold ${
                        overrideLikert === val
                          ? 'border-sky-500 bg-sky-950 text-sky-200'
                          : 'border-slate-800 bg-slate-900 text-slate-400'
                      }`}
                      onClick={() => setOverrideLikert(val)}
                    >
                      {val}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-1.5 pt-1">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleApplyOverride}>
                  Apply Override
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Two-step submit: the background issues a token, the panel echoes it back. */
function SubmitButton({
  busy,
  run,
}: {
  busy: string | null;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);
  const token = useRef<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <Button
        variant="danger"
        disabled={busy !== null}
        onClick={() =>
          run('arm', async () => {
            token.current = await call<string>({ type: 'ISSUE_SUBMIT_TOKEN' });
            setArmed(true);
          })
        }
      >
        Submit form
      </Button>
    );
  }

  return (
    <Button
      variant="danger"
      disabled={busy !== null}
      onClick={() =>
        run('submit', async () => {
          await call({
            type: 'SUBMIT_REQUEST',
            payload: { confirmToken: token.current! },
          });
          setArmed(false);
        })
      }
    >
      Confirm submit
    </Button>
  );
}

function ExportCard({
  busy,
  run,
}: {
  busy: string | null;
  run: (label: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  const { run: summary } = usePanelStore();
  if (!summary) return null;

  const errors = summary.findings.filter((f) => f.severity === 'error').length;
  const warnings = summary.findings.filter((f) => f.severity === 'warning').length;

  return (
    <Section
      title="3. Findings"
      right={
        <span className="flex gap-1">
          {errors > 0 && <Badge tone="red">{errors} error</Badge>}
          {warnings > 0 && <Badge tone="amber">{warnings} warn</Badge>}
          {errors === 0 && warnings === 0 && <Badge tone="green">clean</Badge>}
        </span>
      }
    >
      <ul className="mb-2 max-h-40 space-y-1.5 overflow-y-auto">
        {summary.findings.map((finding, i) => (
          <li key={i} className="text-[11px] leading-snug">
            <span
              className={
                finding.severity === 'error'
                  ? 'text-red-400'
                  : finding.severity === 'warning'
                    ? 'text-amber-400'
                    : 'text-slate-500'
              }
            >
              {finding.code}
            </span>{' '}
            <span className="text-slate-400">{finding.message}</span>
          </li>
        ))}
        {summary.findings.length === 0 && (
          <li className="text-[11px] text-slate-500">No findings recorded.</li>
        )}
      </ul>

      <div className="flex gap-1.5">
        {(['json', 'csv'] as const).map((format) => (
          <Button
            key={format}
            disabled={busy !== null}
            onClick={() =>
              run(`export-${format}`, () =>
                call({
                  type: 'EXPORT_RUN_REQUEST',
                  payload: { runId: summary.runId, format },
                }),
              )
            }
          >
            Export {format.toUpperCase()}
          </Button>
        ))}
      </div>
    </Section>
  );
}

function LogCard() {
  const { logs, clearLogs } = usePanelStore();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length]);

  return (
    <Section
      title="Log"
      right={
        <Button variant="ghost" onClick={clearLogs}>
          Clear
        </Button>
      }
    >
      <div className="max-h-48 overflow-y-auto rounded bg-slate-900 p-2 font-mono text-[10px] leading-relaxed">
        {logs.length === 0 && <p className="text-slate-600">No activity yet.</p>}
        {logs.map((line, i) => (
          <div
            key={i}
            className={
              line.level === 'error'
                ? 'text-red-400'
                : line.level === 'warn'
                  ? 'text-amber-400'
                  : 'text-slate-400'
            }
          >
            <span className="text-slate-600">
              {new Date(line.at).toLocaleTimeString([], { hour12: false })}{' '}
            </span>
            {line.message}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </Section>
  );
}

function Footer() {
  const { tokens } = usePanelStore();
  return (
    <footer className="border-t border-slate-800 bg-slate-900 px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500">
      <div>
        {tokens.calls} call(s) &middot; {tokens.promptTokens.toLocaleString()} prompt /{' '}
        {tokens.responseTokens.toLocaleString()} response tokens
      </div>
      <a
        href={chrome.runtime.getURL('privacy.html')}
        target="_blank"
        rel="noreferrer"
        className="text-slate-400 hover:text-sky-400 underline transition-colors"
      >
        Privacy Policy
      </a>
    </footer>
  );
}
