/**
 * Topology pipeline: resolved model → D2 source → icons inlined → SVG.
 * Renders are debounced, and a render that has been overtaken is dropped.
 */
import type { ResolvedModel } from '../model/resolve';
import { d2Settings, generateD2 } from '../render/d2gen';
import { renderD2 } from '../render/d2render';
import { loadIcons } from '../render/iconload';
import { sanitizeSvg } from '../render/svgsafe';

const DEBOUNCE_MS = 400;

export interface Topology {
  /** Schedules a redraw for a new model. */
  update(model: ResolvedModel): void;
  /** Resolves once nothing is scheduled or being drawn. */
  settled(): Promise<void>;
  /** The current diagram as self-contained SVG text, or null if there is none. */
  svg(): string | null;
  /** Object URL of the current diagram, for <img> (isolated from the page, and what gets printed). */
  imageUrl(): string | null;
  /** The readable D2 source of the current model. */
  source(): string;
  /** Why the last draw failed, or null. */
  error(): string | null;
}

export function createTopology(elements: { stage: HTMLElement; status: HTMLElement; source: HTMLElement }, onChange: () => void): Topology {
  let pending: ResolvedModel | undefined;
  let timer: number | undefined;
  let sequence = 0;
  let drawing = false;
  let svgText: string | null = null;
  let url: string | null = null;
  let source = '';
  let error: string | null = null;
  let waiters: (() => void)[] = [];

  const idle = (): boolean => timer === undefined && !drawing;
  const release = (): void => {
    if (!idle()) return;
    for (const resolve of waiters) resolve();
    waiters = [];
  };

  async function draw(): Promise<void> {
    const model = pending;
    if (!model) return;
    const token = ++sequence;
    drawing = true;
    elements.status.textContent = 'Drawing the diagram…';
    try {
      const icons = await loadIcons([...model.devices.values()].map((d) => d.icon));
      if (token !== sequence) return;
      source = generateD2(model, { icon: (ref) => icons.get(ref)?.readable });
      elements.source.textContent = source;
      const settings = d2Settings(model);
      const result = await renderD2(generateD2(model, { icon: (ref) => icons.get(ref)?.embedded }), settings);
      if (token !== sequence || result.status === 'stale') return;

      const safe = result.status === 'ok' ? sanitizeSvg(result.svg) : null;
      if (result.status === 'ok' && safe) {
        error = null;
        svgText = safe.text;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
        elements.stage.replaceChildren(safe.element);
        const missing = [...icons].filter(([, icon]) => icon === null).map(([ref]) => ref);
        const note = missing.length ? ` Icon not found: ${missing.join(', ')} (drawn as a plain box).` : '';
        elements.status.textContent = `Drawn with ${settings.layout} in ${(result.ms / 1000).toFixed(1)} s.${note}`;
      } else {
        error = result.status === 'error' ? result.message : 'D2 returned something that is not an SVG.';
        const box = document.createElement('pre');
        box.className = 'topology-error';
        box.textContent = `D2 could not draw the diagram:\n${error}`;
        elements.stage.replaceChildren(box);
        elements.status.textContent = 'The diagram could not be drawn. If you use diagram.extra_d2, check it first.';
      }
      onChange();
    } finally {
      if (token === sequence) drawing = false;
      release();
    }
  }

  return {
    update(model) {
      pending = model;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void draw();
      }, DEBOUNCE_MS);
    },
    settled: () => (idle() ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
    svg: () => (error ? null : svgText),
    imageUrl: () => (error ? null : url),
    source: () => source,
    error: () => error,
  };
}
