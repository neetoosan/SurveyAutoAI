import type { PlatformId, SurveyDOMSchema, SurveyQuestion } from '@/types/survey';

/** Attribute the scanner stamps on elements so the fill engine can re-find them exactly. */
export const REF_ATTR = 'data-saqa-ref';

let refCounter = 0;

/** Stamp an element with a fresh reference id (or reuse the existing one). */
export function stampRef(el: Element, prefix = 'r'): string {
  const existing = el.getAttribute(REF_ATTR);
  if (existing) return existing;
  const ref = `${prefix}${++refCounter}`;
  el.setAttribute(REF_ATTR, ref);
  return ref;
}

export function resolveRef(ref: string, root: ParentNode = document): Element | null {
  return root.querySelector(`[${REF_ATTR}="${CSS.escape(ref)}"]`);
}

export function resetRefs(root: ParentNode = document): void {
  root.querySelectorAll(`[${REF_ATTR}]`).forEach((el) => el.removeAttribute(REF_ATTR));
  refCounter = 0;
}

/**
 * Elements the harness will not touch. A QA run reports these rather than
 * working around them: an invisible required input is a finding, not an obstacle.
 */
export function isElementVisibleDirect(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return false;
  }
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0) return false;

  if (style.position === 'absolute' || style.position === 'fixed') {
    const left = Number.parseFloat(style.left);
    const top = Number.parseFloat(style.top);
    if ((Number.isFinite(left) && left <= -1000) || (Number.isFinite(top) && top <= -1000)) {
      return false;
    }
  }
  return true;
}

export function findVisibleAssociatedLabel(el: HTMLInputElement): HTMLElement | null {
  // 1. label[for="id"]
  if (el.id) {
    try {
      const label = document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (label && isElementVisibleDirect(label)) return label;
    } catch {
      // Escape syntax fallback
    }
  }

  // 2. wrapping <label>
  const wrapping = el.closest('label');
  if (wrapping && isElementVisibleDirect(wrapping)) return wrapping;

  // 3. common survey option containers (e.g. Decipher, FocusVision, SurveyMeasure, Qualtrics)
  const container = el.closest<HTMLElement>(
    '.element, .sq-card, .choice, .response, .answer, [class*="radio"], [class*="check"], li, td',
  );
  if (container && isElementVisibleDirect(container)) return container;

  return null;
}

export function visibilityReport(el: Element): { visible: boolean; reason?: string } {
  if (el instanceof HTMLInputElement && el.type === 'hidden') {
    return { visible: false, reason: 'input type=hidden' };
  }
  const style = getComputedStyle(el);
  if (style.display === 'none') {
    if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
      if (findVisibleAssociatedLabel(el)) return { visible: true };
    }
    return { visible: false, reason: 'display:none' };
  }
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return { visible: false, reason: `visibility:${style.visibility}` };
  }

  // If a radio or checkbox is styled with opacity: 0 or zero dimensions,
  // but has an accessible, visible label/card for users to click, it is validly visible.
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    if (findVisibleAssociatedLabel(el)) {
      return { visible: true };
    }
  }

  // Guard the parse: a computed opacity can come back empty, and Number('')
  // is 0, which would mark every element invisible.
  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity === 0) {
    return { visible: false, reason: 'opacity:0' };
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { visible: false, reason: 'zero bounding rect' };
  }
  if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') !== 'false') {
    return { visible: false, reason: 'aria-hidden' };
  }
  if (rect.right <= 0 || rect.bottom <= 0) {
    return { visible: false, reason: 'positioned off-screen' };
  }
  const offScreen = offScreenAncestor(el);
  if (offScreen) return { visible: false, reason: offScreen };
  return { visible: true };
}

/**
 * The `position:absolute; left:-9999px` pattern hides a control from real users
 * while leaving it in the DOM -- most often a honeypot. Its own computed
 * opacity is 1 and, without layout, its own offsets look normal, so the
 * container has to be inspected. Reported, never filled: writing into a trap
 * field would invalidate the run.
 */
function offScreenAncestor(el: Element, maxHops = 6): string | null {
  let cursor: Element | null = el;
  for (let hops = 0; cursor && hops < maxHops; hops++, cursor = cursor.parentElement) {
    const style = getComputedStyle(cursor);
    if (style.position !== 'absolute' && style.position !== 'fixed') continue;
    for (const side of ['left', 'top'] as const) {
      const offset = Number.parseFloat(style[side]);
      if (Number.isFinite(offset) && offset <= -1000) {
        return `positioned off-screen (${side}:${style[side]})`;
      }
    }
  }
  return null;
}

export function cleanText(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, ' ').trim();
}

/** Strip the trailing required marker platforms append to prompts. */
export function stripRequiredMarker(label: string): string {
  return cleanText(label.replace(/\s*\*\s*$/, ''));
}

/** Deterministic id for questions whose platform exposes no stable key. */
export function hashId(...parts: Array<string | number>): string {
  const input = parts.join('\u0000');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `q_${((h2 >>> 0) * 4294967296 + (h1 >>> 0)).toString(36)}`;
}

/**
 * Resolve an accessible label for a control, in descending order of reliability.
 * Mirrors the accname algorithm closely enough for form QA.
 */
export function accessibleLabel(el: Element): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => cleanText(document.getElementById(id)?.textContent))
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  const ariaLabel = cleanText(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;

  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = cleanText(forLabel?.textContent);
    if (text) return text;
  }

  const wrapping = el.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
    const text = cleanText(clone.textContent);
    if (text) return text;
  }

  const card = el.closest('.element, .sq-card, .choice, .response, .answer, [class*="radio"], [class*="check"], li, td');
  if (card && card !== el) {
    const clone = card.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
    const text = cleanText(clone.textContent);
    if (text) return text;
  }

  const fieldset = el.closest('fieldset');
  const legend = cleanText(fieldset?.querySelector('legend')?.textContent);
  if (legend) return legend;

  // Nearest preceding heading or non-empty text block.
  let cursor: Element | null = el;
  for (let hops = 0; cursor && hops < 4; hops++) {
    let sibling = cursor.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName)) {
        const text = cleanText(sibling.textContent);
        if (text) return text;
      }
      sibling = sibling.previousElementSibling;
    }
    cursor = cursor.parentElement;
  }

  const placeholder = cleanText(el.getAttribute('placeholder'));
  if (placeholder) return placeholder;

  return cleanText(el.getAttribute('name')) || '(unlabeled)';
}

export function readConstraints(el: Element): SurveyQuestion['constraints'] {
  const out: NonNullable<SurveyQuestion['constraints']> = {};
  const maxLength = el.getAttribute('maxlength');
  const minLength = el.getAttribute('minlength');
  const pattern = el.getAttribute('pattern');
  const min = el.getAttribute('min');
  const max = el.getAttribute('max');
  if (maxLength && Number(maxLength) > 0) out.maxLength = Number(maxLength);
  if (minLength) out.minLength = Number(minLength);
  if (pattern) out.pattern = pattern;
  if (min !== null && min !== '') out.min = Number(min);
  if (max !== null && max !== '') out.max = Number(max);
  return Object.keys(out).length ? out : undefined;
}

export interface SurveyAdapter {
  id: PlatformId;
  label: string;
  /** Cheap check run against the live document to pick an adapter. */
  detect(): boolean;
  scan(): SurveyDOMSchema;
  /** Locate the control that advances to the next page, if present. */
  findNextControl(): HTMLElement | null;
  /** Locate the final submit control, if present. */
  findSubmitControl(): HTMLElement | null;
}

export function baseSchema(platform: PlatformId, title: string): Omit<SurveyDOMSchema, 'page'> {
  return {
    platform,
    title: cleanText(title) || document.title,
    url: location.href,
    origin: location.origin,
    skipped: [],
    scannedAt: Date.now(),
  };
}
