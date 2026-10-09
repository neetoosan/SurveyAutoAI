import type { PanelRequest } from '@/types/messages';

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Typed wrapper over chrome.runtime.sendMessage for panel -> background calls. */
export async function call<T>(request: PanelRequest | { type: 'ISSUE_SUBMIT_TOKEN' }): Promise<T> {
  const response = (await chrome.runtime.sendMessage(request)) as Envelope<T> | undefined;
  if (!response) throw new Error('Background worker did not respond.');
  if (!response.ok) throw new Error(response.error ?? 'Unknown background error.');
  return response.data as T;
}
