/**
 * Wrapper around D2.js. The library runs the D2 WASM build in its own web
 * worker; this module loads it lazily (it is ~8 MB), feeds it one job at a
 * time, and drops jobs that were overtaken by a newer one.
 */
import type { D2 } from '@terrastruct/d2';
import type { D2Settings } from './d2gen';

export type RenderResult =
  | { status: 'ok'; svg: string; ms: number }
  | { status: 'error'; message: string }
  /** A newer render was requested before this one finished; ignore it. */
  | { status: 'stale' };

interface Job {
  source: string;
  settings: D2Settings;
  resolve: (result: RenderResult) => void;
}

const TIMEOUT_MS = 45_000;

let engine: Promise<D2> | undefined;
let running: Job | undefined;
let waiting: Job | undefined;

function getEngine(): Promise<D2> {
  engine ??= import('@terrastruct/d2').then((module) => new module.D2());
  return engine;
}

/** D2 reports errors as a JSON list of `{ errmsg }`; turn that into plain lines. */
export function formatD2Error(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => (typeof entry === 'object' && entry !== null && 'errmsg' in entry ? String(entry.errmsg) : String(entry))).join('\n');
    }
  } catch {
    // not JSON: use the text as it is
  }
  return text;
}

async function run(job: Job): Promise<RenderResult> {
  const started = performance.now();
  const d2 = await getEngine();
  const compiled = await d2.compile({
    fs: { index: job.source },
    options: { layout: job.settings.layout, sketch: job.settings.sketch, themeID: job.settings.themeID },
  });
  const svg = await d2.render(compiled.diagram, { ...compiled.renderOptions, noXMLTag: true });
  return { status: 'ok', svg, ms: Math.round(performance.now() - started) };
}

function pump(): void {
  if (running || !waiting) return;
  const job = waiting;
  running = job;
  waiting = undefined;
  let timer = 0;
  const timeout = new Promise<RenderResult>((resolve) => {
    timer = window.setTimeout(() => {
      // The worker is stuck (or crashed without answering): start a fresh one next time.
      engine = undefined;
      resolve({ status: 'error', message: 'The diagram took too long to draw and was stopped.' });
    }, TIMEOUT_MS);
  });
  void Promise.race([run(job).catch((error): RenderResult => ({ status: 'error', message: formatD2Error(error) })), timeout]).then((result) => {
    window.clearTimeout(timer);
    running = undefined;
    // If something newer is queued, this result is already out of date.
    job.resolve(waiting ? { status: 'stale' } : result);
    pump();
  });
}

/** Renders D2 source to SVG. Only the most recent request is ever answered with a diagram. */
export function renderD2(source: string, settings: D2Settings): Promise<RenderResult> {
  return new Promise((resolve) => {
    waiting?.resolve({ status: 'stale' });
    waiting = { source, settings, resolve };
    pump();
  });
}
