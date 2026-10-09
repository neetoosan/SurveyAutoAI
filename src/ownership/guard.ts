/**
 * The harness only drives forms the operator has attested they own or
 * administer. This gate is the reason the fill engine needs no evasion
 * behaviour: on your own form there is nothing to evade.
 *
 * Attestations are stored per-origin, carry a timestamp, and are revocable.
 */

const STORAGE_KEY = 'saqa.ownedOrigins';

export interface OwnershipAttestation {
  origin: string;
  /** What the operator claims: they own it, or administer it under permission. */
  basis: 'owner' | 'administrator' | 'written-permission';
  note?: string;
  attestedAt: number;
}

export class OwnershipError extends Error {
  constructor(public readonly origin: string) {
    super(
      `No ownership attestation on record for ${origin}. ` +
        `Register this origin in the side panel before running a fill.`,
    );
    this.name = 'OwnershipError';
  }
}

export async function listAttestations(): Promise<OwnershipAttestation[]> {
  const stored = await chrome.storage.sync.get(STORAGE_KEY);
  return (stored[STORAGE_KEY] as OwnershipAttestation[] | undefined) ?? [];
}

export async function attest(
  origin: string,
  basis: OwnershipAttestation['basis'],
  note?: string,
): Promise<OwnershipAttestation> {
  const normalized = normalizeOrigin(origin);
  const record: OwnershipAttestation = {
    origin: normalized,
    basis,
    note,
    attestedAt: Date.now(),
  };
  const existing = (await listAttestations()).filter((a) => a.origin !== normalized);
  await chrome.storage.sync.set({ [STORAGE_KEY]: [...existing, record] });
  return record;
}

export async function revoke(origin: string): Promise<void> {
  const normalized = normalizeOrigin(origin);
  const remaining = (await listAttestations()).filter((a) => a.origin !== normalized);
  await chrome.storage.sync.set({ [STORAGE_KEY]: remaining });
  await dropHostAccess(normalized);
}

/**
 * Host access, granted per-origin at registration time.
 *
 * Registration is the only place this extension asks for access to a page, so
 * the browser enforces the ownership gate alongside the attestation record
 * above: without the grant, neither a scan nor a fill can reach the tab.
 * `chrome.permissions.request` needs a user gesture, which the register button
 * in the side panel provides.
 */
function patternFor(origin: string): string {
  try {
    return `${new URL(origin).origin}/*`;
  } catch {
    return origin;
  }
}

export async function hasHostAccess(origin: string): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: [patternFor(origin)] });
  } catch {
    return false;
  }
}

export async function requestHostAccess(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [patternFor(origin)] });
}

export async function dropHostAccess(origin: string): Promise<void> {
  await chrome.permissions.remove({ origins: [patternFor(origin)] }).catch(() => false);
}

export async function isAttested(origin: string): Promise<boolean> {
  const normalized = normalizeOrigin(origin);
  return (await listAttestations()).some((a) => a.origin === normalized);
}

/** Throws unless the origin has been attested. */
export async function requireAttestation(origin: string): Promise<OwnershipAttestation> {
  const normalized = normalizeOrigin(origin);
  const match = (await listAttestations()).find((a) => a.origin === normalized);
  if (!match) throw new OwnershipError(normalized);
  return match;
}

export function normalizeOrigin(input: string): string {
  try {
    return new URL(input).origin;
  } catch {
    return input;
  }
}

/**
 * Google Forms and Typeform put every form on one shared origin, so an
 * attestation there cannot be origin-scoped alone. For those platforms the
 * operator attests the specific form URL path instead.
 */
const SHARED_ORIGIN_HOSTS = [
  'docs.google.com',
  'forms.gle',
  'form.typeform.com',
  'www.surveymonkey.com',
];

export function attestationKeyFor(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin === 'null' || !parsed.protocol.startsWith('http')) {
      return '';
    }
    if (SHARED_ORIGIN_HOSTS.some((h) => parsed.hostname.endsWith(h))) {
      // Keep the form identifier, drop query strings and response state.
      return `${parsed.origin}${parsed.pathname.replace(/\/(viewform|edit|formResponse).*$/, '')}`;
    }
    return parsed.origin;
  } catch {
    return url;
  }
}
