import type { PlannedAnswer } from '@/types/respondent';
import type { SurveyDOMSchema } from '@/types/survey';
import { resolveRef } from '@/adapters';

/**
 * Review mode overlay. Renders the proposed answer next to each question in a
 * shadow root so the host page's stylesheet cannot alter it and the harness
 * cannot alter the host page's layout.
 */

const HOST_ID = 'saqa-review-overlay';

interface Marker {
  ref: string;
  label: string;
  rationale: string;
  severity: 'proposed' | 'uncertain';
}

function ensureHost(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (host?.shadowRoot) return host.shadowRoot;

  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .box {
      position: absolute;
      border-radius: 6px;
      border: 2px solid var(--c);
      background: color-mix(in srgb, var(--c) 12%, transparent);
      pointer-events: none;
      box-sizing: border-box;
      transition: opacity 120ms ease;
    }
    .chip {
      position: absolute;
      font: 500 11px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;
      color: #fff;
      background: var(--c);
      padding: 3px 7px;
      border-radius: 4px 4px 0 0;
      white-space: nowrap;
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      transform: translateY(-100%);
    }
    .proposed { --c: #b45309; }
    .uncertain { --c: #b91c1c; }
  `;
  shadow.appendChild(style);
  return shadow;
}

export function clearHighlights(): void {
  document.getElementById(HOST_ID)?.remove();
}

function describe(answer: PlannedAnswer, schema: SurveyDOMSchema): string {
  const question = schema.page.questions.find((q) => q.id === answer.questionId);
  if (!question) return '(unknown question)';

  if (answer.textAnswer != null) {
    const text = answer.textAnswer;
    return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
  if (answer.likertValue != null) return `Scale: ${answer.likertValue}`;
  if (answer.selectedOptionIndex != null) {
    return (
      question.options?.[answer.selectedOptionIndex]?.label ?? `#${answer.selectedOptionIndex}`
    );
  }
  if (answer.selectedOptionIndexes?.length) {
    return answer.selectedOptionIndexes
      .map((i) => question.options?.[i]?.label ?? `#${i}`)
      .join(', ');
  }
  if (answer.matrixSelections) {
    return `${Object.keys(answer.matrixSelections).length} row(s) selected`;
  }
  return '(no value)';
}

export function renderHighlights(schema: SurveyDOMSchema, answers: PlannedAnswer[]): void {
  const shadow = ensureHost();
  shadow.querySelectorAll('.box, .chip').forEach((n) => n.remove());

  const markers: Marker[] = answers.flatMap((answer) => {
    const question = schema.page.questions.find((q) => q.id === answer.questionId);
    if (!question) return [];
    return [
      {
        ref: question.domRef,
        label: `${question.label.slice(0, 40)} -> ${describe(answer, schema)}`,
        rationale: answer.rationale,
        severity: answer.uncertain ? ('uncertain' as const) : ('proposed' as const),
      },
    ];
  });

  const draw = () => {
    shadow.querySelectorAll('.box, .chip').forEach((n) => n.remove());
    for (const marker of markers) {
      const el = resolveRef(marker.ref);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const top = rect.top + window.scrollY;
      const left = rect.left + window.scrollX;

      const box = document.createElement('div');
      box.className = `box ${marker.severity}`;
      box.style.cssText = `top:${top}px;left:${left}px;width:${rect.width}px;height:${rect.height}px`;

      const chip = document.createElement('div');
      chip.className = `chip ${marker.severity}`;
      chip.style.cssText = `top:${top}px;left:${left}px`;
      chip.textContent = marker.label;
      chip.title = marker.rationale;

      shadow.append(box, chip);
    }
  };

  draw();

  // Keep the overlay pinned to its targets while the page moves under it.
  const redraw = () => requestAnimationFrame(draw);
  window.addEventListener('scroll', redraw, { passive: true });
  window.addEventListener('resize', redraw, { passive: true });
}
