import { describe, expect, it } from 'vitest';
import { detectCaptcha, isHoneypot } from '@/dom/tripwire';

describe('Safety Tripwires & Anti-Bot Defense', () => {
  describe('detectCaptcha', () => {
    it('returns null on a clean page with no bot challenges', () => {
      const container = document.createElement('div');
      container.innerHTML = '<form><input type="text" name="name" /></form>';
      expect(detectCaptcha(container)).toBeNull();
    });

    it('detects Google reCAPTCHA iframes and containers', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div class="g-recaptcha" data-sitekey="xyz"></div>';
      // In happy-dom, stub getBoundingClientRect
      const el = container.querySelector('.g-recaptcha') as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ width: 300, height: 78, top: 0, left: 0, right: 300, bottom: 78 } as DOMRect);

      const detected = detectCaptcha(container);
      expect(detected).not.toBeNull();
      expect(detected?.platform).toBe('recaptcha');
    });

    it('detects hCaptcha containers', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div class="h-captcha" data-sitekey="xyz"></div>';
      const el = container.querySelector('.h-captcha') as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ width: 300, height: 78, top: 0, left: 0, right: 300, bottom: 78 } as DOMRect);

      const detected = detectCaptcha(container);
      expect(detected).not.toBeNull();
      expect(detected?.platform).toBe('hCaptcha'.toLowerCase());
    });

    it('detects Cloudflare Turnstile challenges', () => {
      const container = document.createElement('div');
      container.innerHTML = '<div class="cf-turnstile" data-sitekey="xyz"></div>';
      const el = container.querySelector('.cf-turnstile') as HTMLElement;
      el.getBoundingClientRect = () =>
        ({ width: 300, height: 65, top: 0, left: 0, right: 300, bottom: 65 } as DOMRect);

      const detected = detectCaptcha(container);
      expect(detected).not.toBeNull();
      expect(detected?.platform).toBe('turnstile');
    });

    it('detects Arkose Labs / FunCaptcha challenges', () => {
      const container = document.createElement('div');
      container.innerHTML = '<iframe src="https://client-api.arkoselabs.com/fc/api/"></iframe>';

      const detected = detectCaptcha(container);
      expect(detected).not.toBeNull();
      expect(detected?.platform).toBe('arkose');
    });
  });

  describe('isHoneypot', () => {
    it('flags input[type="hidden"] as a trap', () => {
      const input = document.createElement('input');
      input.type = 'hidden';
      expect(isHoneypot(input).isTrap).toBe(true);
    });

    it('flags opacity: 0 as a trap', () => {
      const input = document.createElement('input');
      input.style.opacity = '0';
      input.getBoundingClientRect = () =>
        ({ width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30 } as DOMRect);

      expect(isHoneypot(input).isTrap).toBe(true);
      expect(isHoneypot(input).reason).toContain('opacity');
    });

    it('flags display: none as a trap', () => {
      const input = document.createElement('input');
      input.style.display = 'none';

      expect(isHoneypot(input).isTrap).toBe(true);
      expect(isHoneypot(input).reason).toContain('display:none');
    });

    it('flags off-screen absolute positioning as a trap', () => {
      const wrapper = document.createElement('div');
      wrapper.style.position = 'absolute';
      wrapper.style.left = '-9999px';

      const input = document.createElement('input');
      input.id = 'trap';
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      input.getBoundingClientRect = () =>
        ({ width: 100, height: 20, top: 10, left: -9999, right: -9899, bottom: 30 } as DOMRect);

      expect(isHoneypot(input).isTrap).toBe(true);
      wrapper.remove();
    });

    it('allows normal visible form inputs', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.name = 'real_field';
      input.getBoundingClientRect = () =>
        ({ width: 200, height: 32, top: 20, left: 20, right: 220, bottom: 52 } as DOMRect);

      expect(isHoneypot(input).isTrap).toBe(false);
    });
  });
});
