import { describe, expect, it } from 'vitest';
import {
  gaussianRandom,
  setNativeValue,
  simulateHumanClick,
  simulateHumanInput,
  simulateSelectDropdown,
} from '@/dom/emulation';

describe('DOM Emulation Engine', () => {
  describe('gaussianRandom', () => {
    it('produces values clamped within bounds', () => {
      for (let i = 0; i < 100; i++) {
        const val = gaussianRandom(40, 120);
        expect(val).toBeGreaterThanOrEqual(40);
        expect(val).toBeLessThanOrEqual(120);
      }
    });

    it('centers approximately near the mean', () => {
      let sum = 0;
      const count = 500;
      for (let i = 0; i < count; i++) {
        sum += gaussianRandom(10, 90);
      }
      const mean = sum / count;
      // Mean of 10 and 90 is 50; sample mean should be reasonably close
      expect(mean).toBeGreaterThan(35);
      expect(mean).toBeLessThan(65);
    });
  });

  describe('setNativeValue', () => {
    it('updates text input value', () => {
      const input = document.createElement('input');
      setNativeValue(input, 'test-val');
      expect(input.value).toBe('test-val');
    });
  });

  describe('simulateHumanInput', () => {
    it('fires complete event lifecycle in sequence', async () => {
      const input = document.createElement('input');
      document.body.appendChild(input);

      const events: string[] = [];
      const record = (e: Event) => events.push(e.type);

      ['focus', 'keydown', 'beforeinput', 'input', 'keyup', 'change', 'blur'].forEach((type) => {
        input.addEventListener(type, record);
      });

      await simulateHumanInput(input, 'Hi', { speed: 'instant' });

      expect(input.value).toBe('Hi');
      expect(events).toContain('focus');
      expect(events).toContain('keydown');
      expect(events).toContain('beforeinput');
      expect(events).toContain('input');
      expect(events).toContain('keyup');
      expect(events).toContain('change');
      expect(events).toContain('blur');

      input.remove();
    });
  });

  describe('simulateHumanClick', () => {
    it('fires pointer and mouse event chain', async () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);

      const events: string[] = [];
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
        btn.addEventListener(type, () => events.push(type));
      });

      await simulateHumanClick(btn, { speed: 'instant' });

      expect(events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      btn.remove();
    });

    it('toggles a checkbox input', async () => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      document.body.appendChild(cb);

      expect(cb.checked).toBe(false);
      await simulateHumanClick(cb, { speed: 'instant' });
      expect(cb.checked).toBe(true);
      await simulateHumanClick(cb, { speed: 'instant' });
      expect(cb.checked).toBe(false);

      cb.remove();
    });
  });

  describe('simulateSelectDropdown', () => {
    it('selects option by index and dispatches input and change', async () => {
      const select = document.createElement('select');
      const opt1 = document.createElement('option');
      opt1.value = 'opt-1';
      opt1.text = 'First';
      const opt2 = document.createElement('option');
      opt2.value = 'opt-2';
      opt2.text = 'Second';
      select.appendChild(opt1);
      select.appendChild(opt2);
      document.body.appendChild(select);

      const events: string[] = [];
      select.addEventListener('input', () => events.push('input'));
      select.addEventListener('change', () => events.push('change'));

      await simulateSelectDropdown(select, 1, { speed: 'instant' });

      expect(select.value).toBe('opt-2');
      expect(events).toEqual(['input', 'change']);

      select.remove();
    });
  });
});
