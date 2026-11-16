/**
 * Everything the app remembers between visits lives in localStorage under the
 * `netplan.` prefix. Storage can be unavailable (private mode, blocked site
 * data), so every access is guarded and the app works without it.
 */
import type { HiddenColumns } from '../render/plan';

const KEYS = {
  text: 'netplan.yaml',
  columns: 'netplan.columns',
  split: 'netplan.split',
  tab: 'netplan.tab',
} as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the app keeps working, it just will not remember.
  }
}

export const store = {
  loadText: (): string | null => read(KEYS.text),
  saveText: (text: string): void => write(KEYS.text, text),

  loadColumns(): HiddenColumns {
    try {
      const parsed: unknown = JSON.parse(read(KEYS.columns) ?? '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const out: HiddenColumns = {};
      for (const [table, keys] of Object.entries(parsed)) {
        if (Array.isArray(keys)) out[table] = keys.filter((k): k is string => typeof k === 'string');
      }
      return out;
    } catch {
      return {};
    }
  },
  saveColumns: (hidden: HiddenColumns): void => write(KEYS.columns, JSON.stringify(hidden)),

  loadSplit(): number {
    const value = Number(read(KEYS.split));
    return Number.isFinite(value) && value >= 20 && value <= 80 ? value : 42;
  },
  saveSplit: (percent: number): void => write(KEYS.split, String(Math.round(percent))),

  loadTab: (): string | null => read(KEYS.tab),
  saveTab: (tab: string): void => write(KEYS.tab, tab),
};
