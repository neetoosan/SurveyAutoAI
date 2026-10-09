import type { RunSummary } from '@/types/messages';

const RUNS_KEY = 'saqa.runs';
const MAX_RETAINED = 25;

export async function listRuns(): Promise<RunSummary[]> {
  const stored = await chrome.storage.local.get(RUNS_KEY);
  return (stored[RUNS_KEY] as RunSummary[] | undefined) ?? [];
}

export async function saveRun(run: RunSummary): Promise<void> {
  const runs = await listRuns();
  const next = [run, ...runs.filter((r) => r.runId !== run.runId)].slice(0, MAX_RETAINED);
  await chrome.storage.local.set({ [RUNS_KEY]: next });
}

export async function getRun(runId: string): Promise<RunSummary | undefined> {
  return (await listRuns()).find((r) => r.runId === runId);
}

export async function clearRuns(): Promise<void> {
  await chrome.storage.local.remove(RUNS_KEY);
}

function escapeCsv(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function runToCsv(run: RunSummary): string {
  const header = [
    'run_id',
    'respondent',
    'form_title',
    'platform',
    'question_id',
    'question_label',
    'question_type',
    'answer',
    'rationale',
    'error',
    'filled_at',
  ];

  const rows = run.answers.map((a) => {
    const answer =
      a.value.textAnswer ??
      a.value.likertValue ??
      a.value.selectedOptionIndex ??
      a.value.selectedOptionIndexes?.join('|') ??
      (a.value.matrixSelections ? JSON.stringify(a.value.matrixSelections) : '');

    return [
      run.runId,
      run.respondent.name,
      run.schema.title,
      run.schema.platform,
      a.questionId,
      a.questionLabel,
      a.questionType,
      answer,
      a.rationale ?? '',
      a.error ?? '',
      new Date(a.filledAt).toISOString(),
    ];
  });

  return [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\n');
}

export function runToJson(run: RunSummary): string {
  return JSON.stringify(run, null, 2);
}

/**
 * Service workers have no DOM, so the download goes out as a data URL rather
 * than an object URL from createObjectURL.
 */
export async function downloadRun(run: RunSummary, format: 'json' | 'csv'): Promise<void> {
  const body = format === 'csv' ? runToCsv(run) : runToJson(run);
  const mime = format === 'csv' ? 'text/csv' : 'application/json';
  const stamp = new Date(run.startedAt).toISOString().replace(/[:.]/g, '-');
  const slug = run.schema.title
    .replace(/[^a-z0-9]+/gi, '-')
    .slice(0, 40)
    .toLowerCase();

  await chrome.downloads.download({
    url: `data:${mime};charset=utf-8,${encodeURIComponent(body)}`,
    filename: `saqa-${slug}-${stamp}.${format}`,
    saveAs: true,
  });
}
