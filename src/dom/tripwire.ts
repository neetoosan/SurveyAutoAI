import { findVisibleAssociatedLabel } from '@/adapters/base';

/**
 * Safety Tripwires & Anti-Bot Defense Engine (Phase 4)
 *
 * Inspects the page for bot-detection challenges (reCAPTCHA, hCaptcha,
 * Cloudflare Turnstile, Arkose Labs) and honeypot traps.
 */

export interface CaptchaChallenge {
  platform: 'recaptcha' | 'hcaptcha' | 'turnstile' | 'arkose' | 'cloudflare' | 'generic';
  selector: string;
  description: string;
  detectedAt: number;
}

interface DetectorRule {
  platform: CaptchaChallenge['platform'];
  selectors: string[];
  description: string;
}

const DETECTORS: DetectorRule[] = [
  {
    platform: 'turnstile',
    selectors: [
      'iframe[src*="challenges.cloudflare.com"]',
      '.cf-turnstile',
      'div[id*="cf-turnstile"]',
      '[data-turnstile-sitekey]',
    ],
    description: 'Cloudflare Turnstile challenge',
  },
  {
    platform: 'hcaptcha',
    selectors: [
      'iframe[src*="hcaptcha.com"]',
      '.h-captcha',
      'div[id*="hcaptcha"]',
      '[data-hcaptcha-sitekey]',
    ],
    description: 'hCaptcha verification challenge',
  },
  {
    platform: 'arkose',
    selectors: [
      'iframe[src*="arkoselabs.com"]',
      'iframe[src*="funcaptcha"]',
      '#fc-iframe-wrap',
      '.arkose-frame',
    ],
    description: 'Arkose Labs (FunCaptcha) challenge',
  },
  {
    platform: 'recaptcha',
    selectors: [
      'iframe[src*="google.com/recaptcha"]',
      'iframe[src*="recaptcha/api2"]',
      'iframe[src*="recaptcha/enterprise"]',
      '.g-recaptcha',
      'div[id*="recaptcha"]',
      '[data-sitekey]:not(.h-captcha):not(.cf-turnstile):not([data-turnstile-sitekey]):not([data-hcaptcha-sitekey])',
    ],
    description: 'Google reCAPTCHA verification challenge',
  },
  {
    platform: 'cloudflare',
    selectors: [
      '#challenge-running',
      '#challenge-stage',
      '#cf-challenge-running',
      '.cf-browser-verification',
    ],
    description: 'Cloudflare bot verification interstitial',
  },
];

/**
 * Checks whether an element is visible in layout or active in the DOM.
 */
function isChallengeVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  // An active captcha iframe or widget container typically has positive dimensions or is attached
  return (rect.width > 0 && rect.height > 0) || el.tagName.toLowerCase() === 'iframe';
}

/**
 * Inspects the current page or subtree for CAPTCHA / bot challenge tripwires.
 */
export function detectCaptcha(root: Document | Element = document): CaptchaChallenge | null {
  for (const detector of DETECTORS) {
    for (const selector of detector.selectors) {
      try {
        const match = root.querySelector(selector);
        if (match && isChallengeVisible(match)) {
          return {
            platform: detector.platform,
            selector,
            description: detector.description,
            detectedAt: Date.now(),
          };
        }
      } catch {
        // QuerySelector syntax safety fallback
      }
    }
  }
  return null;
}

/**
 * Watches DOM mutations in real time. If a CAPTCHA or Turnstile frame is dynamically
 * injected, triggers the callback immediately to halt automated execution.
 */
export function setupCaptchaWatcher(
  onDetected: (challenge: CaptchaChallenge) => void,
  root: Node = document.documentElement,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const challenge = detectCaptcha();
      if (challenge) {
        onDetected(challenge);
      }
    }, 250);
  });

  observer.observe(root, { childList: true, subtree: true });

  return () => {
    clearTimeout(debounceTimer);
    observer.disconnect();
  };
}

/**
 * Comprehensive honeypot trap detector.
 * Identifies inputs hidden via zero size, opacity 0, off-screen offsets, clip-rects,
 * or trap naming patterns that would invalidate survey runs if filled.
 */
export function isHoneypot(el: Element): { isTrap: boolean; reason?: string } {
  if (el instanceof HTMLInputElement && el.type === 'hidden') {
    return { isTrap: true, reason: 'input[type="hidden"]' };
  }

  // Custom-styled radios and checkboxes with visible labels or containers are legitimate form inputs
  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    if (findVisibleAssociatedLabel(el)) {
      return { isTrap: false };
    }
  }

  if (el instanceof HTMLElement) {
    if (el.style.display === 'none') {
      return { isTrap: true, reason: 'display:none' };
    }
    const inlineOpacity = Number.parseFloat(el.style.opacity);
    if (Number.isFinite(inlineOpacity) && inlineOpacity === 0) {
      return { isTrap: true, reason: 'opacity:0' };
    }
    if (el.style.visibility === 'hidden' || el.style.visibility === 'collapse') {
      return { isTrap: true, reason: `visibility:${el.style.visibility}` };
    }
  }

  const style = window.getComputedStyle(el);
  if (style.display === 'none') {
    return { isTrap: true, reason: 'display:none' };
  }
  if (style.visibility === 'hidden' || style.visibility === 'collapse') {
    return { isTrap: true, reason: `visibility:${style.visibility}` };
  }

  const opacity = Number.parseFloat(style.opacity);
  if (Number.isFinite(opacity) && opacity === 0) {
    return { isTrap: true, reason: 'opacity:0' };
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { isTrap: true, reason: 'zero bounding rect' };
  }

  if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') !== 'false') {
    return { isTrap: true, reason: 'aria-hidden' };
  }

  if (rect.right <= 0 || rect.bottom <= 0) {
    return { isTrap: true, reason: 'positioned off-screen' };
  }

  // Check CSS clipping (common in accessibility-hidden honeypots)
  if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clip === 'rect(0, 0, 0, 0)') {
    return { isTrap: true, reason: 'clip:rect(0,0,0,0)' };
  }
  if (style.clipPath && (style.clipPath.includes('inset(50%)') || style.clipPath.includes('circle(0)'))) {
    return { isTrap: true, reason: 'clip-path hidden' };
  }

  // Check container ancestry for off-screen positioning
  let cursor: Element | null = el.parentElement;
  for (let hops = 0; cursor && hops < 6; hops++, cursor = cursor.parentElement) {
    const parentStyle = window.getComputedStyle(cursor);
    if (parentStyle.position === 'absolute' || parentStyle.position === 'fixed') {
      for (const side of ['left', 'top'] as const) {
        const offset = Number.parseFloat(parentStyle[side]);
        if (Number.isFinite(offset) && offset <= -1000) {
          return { isTrap: true, reason: `ancestor off-screen (${side}:${parentStyle[side]})` };
        }
      }
    }
    const parentOpacity = Number.parseFloat(parentStyle.opacity);
    if (Number.isFinite(parentOpacity) && parentOpacity === 0) {
      return { isTrap: true, reason: 'ancestor opacity:0' };
    }
  }

  // Honeypot name/id pattern heuristics if also flagged with tabindex=-1 or autocomplete=off
  const identifier = `${(el as HTMLInputElement).name || ''} ${el.id || ''} ${el.className || ''}`.toLowerCase();
  const trapKeyword = /trap|honeypot|bot[-_]?field|hp[-_]|fake[-_]?field/i.test(identifier);
  if (trapKeyword && (el.getAttribute('tabindex') === '-1' || rect.width <= 1 || rect.height <= 1)) {
    return { isTrap: true, reason: 'honeypot keyword attribute pattern' };
  }

  return { isTrap: false };
}
