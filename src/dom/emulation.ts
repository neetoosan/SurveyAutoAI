/**
 * Human-Grade DOM Emulation Engine (Phase 4)
 *
 * Dispatches complete event lifecycles to mimic genuine human interaction,
 * defeating bot-detection, honeypot traps, and framework event cancellation.
 */

export interface EmulationOptions {
  speed?: 'human' | 'instant';
  minDelay?: number;
  maxDelay?: number;
}

/** Sleep utility for async delays. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Box-Muller transform to produce a Gaussian (normal) distribution.
 * Clamps result between min and max.
 */
export function gaussianRandom(min: number, max: number, skew = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  num = num / 10.0 + 0.5; // Translate to 0 -> 1

  if (num > 1 || num < 0) {
    num = gaussianRandom(min, max, skew); // Resample if out of bounds
  } else {
    num = Math.pow(num, skew);
    num = min + num * (max - min);
  }
  return Math.round(num);
}

/**
 * Write value via native property descriptor so React/Vue/Angular tracker
 * caches are not bypassed.
 */
export function setNativeValue(
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const prototype = Object.getPrototypeOf(el) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

/**
 * Smoothly scrolls element into the viewport with human-like deceleration.
 */
export async function scrollIntoViewHuman(
  el: Element,
  options?: EmulationOptions,
): Promise<void> {
  if (!(el instanceof HTMLElement)) return;

  const isInstant = options?.speed === 'instant';
  el.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: isInstant ? 'instant' : 'smooth',
  });

  if (!isInstant) {
    // Saccade / gaze settling delay
    await sleep(gaussianRandom(120, 260));
  }
}

/**
 * Calculates synthetic mouse coordinates with a randomized offset
 * around the center of the element rect.
 */
export function calculateClickCoordinates(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return { x: 0, y: 0 };
  }
  // Click between 30% and 70% of element dimensions
  const offsetX = rect.width * (0.3 + Math.random() * 0.4);
  const offsetY = rect.height * (0.3 + Math.random() * 0.4);
  return {
    x: Math.round(rect.left + offsetX),
    y: Math.round(rect.top + offsetY),
  };
}

/**
 * Simulates complete human input lifecycle for text inputs and textareas:
 * Focus -> FocusEvent -> Char-by-char Keydown/BeforeInput/Setter/Input/Keyup -> Change -> Blur
 */
export async function simulateHumanInput(
  inputEl: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  options?: EmulationOptions,
): Promise<void> {
  const isInstant = options?.speed === 'instant';
  const minDelay = options?.minDelay ?? 40;
  const maxDelay = options?.maxDelay ?? 120;

  await scrollIntoViewHuman(inputEl, options);

  // Focus sequence
  inputEl.focus();
  inputEl.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  // Simulate mouse click on the input field prior to typing
  const coords = calculateClickCoordinates(inputEl);
  inputEl.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: coords.x, clientY: coords.y }),
  );
  inputEl.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, clientX: coords.x, clientY: coords.y }),
  );
  inputEl.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: coords.x, clientY: coords.y }),
  );
  inputEl.dispatchEvent(
    new MouseEvent('mouseup', { bubbles: true, clientX: coords.x, clientY: coords.y }),
  );
  inputEl.dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: coords.x, clientY: coords.y }),
  );

  if (!isInstant) {
    // Initial thinking / finger placement delay
    await sleep(gaussianRandom(80, 200));
  }

  // Character-by-character typing pipeline
  let currentVal = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    // Keydown
    inputEl.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
      }),
    );

    // BeforeInput
    inputEl.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char,
      }),
    );

    // Value update through native descriptor
    currentVal += char;
    setNativeValue(inputEl, currentVal);

    // InputEvent
    inputEl.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: char,
      }),
    );

    // Keyup
    inputEl.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: char,
        bubbles: true,
      }),
    );

    if (!isInstant) {
      let delay = gaussianRandom(minDelay, maxDelay);

      // Punctuation and spaces have natural human pauses
      if (char === ' ') {
        delay += gaussianRandom(40, 90);
      } else if (['.', ',', '!', '?', ';', ':'].includes(char)) {
        delay += gaussianRandom(120, 240);
      }

      // Rare brief hesitation (2% chance)
      if (Math.random() < 0.02) {
        delay += gaussianRandom(200, 450);
      }

      await sleep(delay);
    }
  }

  // Commit and unfocus
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  inputEl.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  inputEl.blur();
}

/**
 * Simulates complete synthetic mouse movement and click sequence:
 * Smooth Scroll -> PointerOver -> MouseOver -> PointerEnter -> MouseEnter ->
 * PointerMove -> PointerDown -> MouseDown -> Focus -> Hold Delay -> PointerUp -> MouseUp -> Click
 */
export async function simulateHumanClick(
  el: Element,
  options?: EmulationOptions,
): Promise<void> {
  const isInstant = options?.speed === 'instant';

  await scrollIntoViewHuman(el, options);

  const coords = calculateClickCoordinates(el);
  const eventInit: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    clientX: coords.x,
    clientY: coords.y,
    button: 0,
    buttons: 1,
  };

  // Hover trajectory
  el.dispatchEvent(new PointerEvent('pointerover', { ...eventInit, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseover', { ...eventInit, buttons: 0 }));
  el.dispatchEvent(new PointerEvent('pointerenter', { ...eventInit, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mouseenter', { ...eventInit, buttons: 0 }));
  el.dispatchEvent(new PointerEvent('pointermove', { ...eventInit, buttons: 0 }));
  el.dispatchEvent(new MouseEvent('mousemove', { ...eventInit, buttons: 0 }));

  if (!isInstant) {
    await sleep(gaussianRandom(30, 80));
  }

  // Button down
  el.dispatchEvent(new PointerEvent('pointerdown', eventInit));
  el.dispatchEvent(new MouseEvent('mousedown', eventInit));

  if (el instanceof HTMLElement) {
    el.focus({ preventScroll: true });
  }

  // Button hold duration (human finger depression)
  if (!isInstant) {
    await sleep(gaussianRandom(40, 100));
  }

  // Button up & click
  const upInit: PointerEventInit = { ...eventInit, buttons: 0 };
  el.dispatchEvent(new PointerEvent('pointerup', upInit));
  el.dispatchEvent(new MouseEvent('mouseup', upInit));

  if (el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox')) {
    // Calling .click() on native input executes browser default checked toggle and change/input lifecycle
    (el as HTMLElement).click();
    if (!el.checked && el.type === 'radio') {
      const label = el.closest('label') ?? (el.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`) : null);
      label?.click();
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.dispatchEvent(new MouseEvent('click', upInit));
  }
}

/**
 * Selects an option in a native <select> element with change events.
 */
export async function simulateSelectDropdown(
  el: HTMLSelectElement,
  index: number,
  options?: EmulationOptions,
): Promise<void> {
  const option = el.options[index];
  if (!option) throw new Error(`option index ${index} out of range (${el.options.length})`);

  await scrollIntoViewHuman(el, options);
  el.focus();
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

  setNativeValue(el, option.value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}
