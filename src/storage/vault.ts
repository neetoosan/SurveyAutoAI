/**
 * API key storage.
 *
 * A note on the threat model, because it is easy to build security theatre
 * here: encrypting a key with a second key kept beside it protects nothing.
 * So the vault has two honest modes.
 *
 *   - Passphrase mode: AES-GCM under a PBKDF2-derived key. The passphrase is
 *     never persisted, so the key is unreadable at rest without the operator.
 *     Cost: re-entry once per browser session.
 *   - Plain mode: the key sits in chrome.storage.local, readable by anything
 *     with access to the extension's storage. Convenient, and no worse than
 *     every other extension that stores a token -- but not encrypted, and the
 *     UI says so rather than implying otherwise.
 *
 * Either way the key lives in storage.local, not storage.sync: pushing a
 * credential through a browser-profile sync channel widens its exposure for
 * no real gain.
 */

const KEY_RECORD = 'saqa.apiKey';
const PBKDF2_ITERATIONS = 310_000;

export type VaultMode = 'passphrase' | 'plain';

interface EncryptedRecord {
  mode: 'passphrase';
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
}

interface PlainRecord {
  mode: 'plain';
  value: string;
}

type VaultRecord = EncryptedRecord | PlainRecord;

/** Held in service-worker memory only; cleared when the worker is torn down. */
let unlockedKey: string | null = null;

function toBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function storeKey(
  apiKey: string,
  options: { passphrase?: string } = {},
): Promise<VaultMode> {
  if (options.passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
    const key = await deriveKey(options.passphrase, salt, PBKDF2_ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(apiKey),
    );

    const record: EncryptedRecord = {
      mode: 'passphrase',
      salt: toBase64(salt.buffer),
      iv: toBase64(iv.buffer),
      ciphertext: toBase64(ciphertext),
      iterations: PBKDF2_ITERATIONS,
    };
    await chrome.storage.local.set({ [KEY_RECORD]: record });
    unlockedKey = apiKey;
    return 'passphrase';
  }

  const record: PlainRecord = { mode: 'plain', value: apiKey };
  await chrome.storage.local.set({ [KEY_RECORD]: record });
  unlockedKey = apiKey;
  return 'plain';
}

export async function getVaultMode(): Promise<VaultMode | null> {
  const stored = await chrome.storage.local.get(KEY_RECORD);
  const record = stored[KEY_RECORD] as VaultRecord | undefined;
  return record?.mode ?? null;
}

export async function unlock(passphrase: string): Promise<void> {
  const stored = await chrome.storage.local.get(KEY_RECORD);
  const record = stored[KEY_RECORD] as VaultRecord | undefined;
  if (!record) throw new Error('No API key stored.');
  if (record.mode === 'plain') {
    unlockedKey = record.value;
    return;
  }

  const key = await deriveKey(passphrase, fromBase64(record.salt), record.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv) },
      key,
      fromBase64(record.ciphertext),
    );
    unlockedKey = new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM authentication failure is the only realistic cause here.
    throw new Error('Incorrect passphrase.');
  }
}

/** Returns the key if available, else null. Callers surface the unlock prompt. */
export async function getKey(): Promise<string | null> {
  if (unlockedKey) return unlockedKey;
  const stored = await chrome.storage.local.get(KEY_RECORD);
  const record = stored[KEY_RECORD] as VaultRecord | undefined;
  if (record?.mode === 'plain') {
    unlockedKey = record.value;
    return unlockedKey;
  }
  return null;
}

export function lock(): void {
  unlockedKey = null;
}

export async function clearKey(): Promise<void> {
  unlockedKey = null;
  await chrome.storage.local.remove(KEY_RECORD);
}

export function isUnlocked(): boolean {
  return unlockedKey !== null;
}
