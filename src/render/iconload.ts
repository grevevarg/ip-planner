/**
 * Fetches the icons a diagram needs and turns them into data URIs, so the
 * rendered SVG is self-contained (it prints, and "Download SVG" needs no
 * other files). Only same-origin files are fetched; https icons are passed
 * through untouched.
 */
import { classifyIcon, iconPath } from '../model/icons';
import type { IconInfo } from './d2gen';
import { fitIcon, svgAspect } from './iconsize';

export interface LoadedIcon {
  /** What is rendered: a data URI, or the URL for a remote icon. */
  embedded: IconInfo;
  /** What the "D2 source" tab shows: the readable path instead of the data URI. */
  readable: IconInfo;
}

const cache = new Map<string, Promise<LoadedIcon | null>>();

function toDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('could not read icon'));
    reader.readAsDataURL(blob);
  });
}

async function load(ref: string): Promise<LoadedIcon | null> {
  if (classifyIcon(ref) === 'remote') {
    const info = { href: ref, ...fitIcon(null) };
    return { embedded: info, readable: info };
  }
  const path = iconPath(ref);
  if (!path) return null;
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) return null;
  const isSvg = /\.svg$/i.test(path);
  const original = await response.blob();
  // Some servers send SVG as text/plain or application/octet-stream; the data URI must say what it is.
  const blob = isSvg ? new Blob([original], { type: 'image/svg+xml' }) : original;
  let natural: { width: number; height: number } | null = null;
  if (isSvg) {
    natural = svgAspect(await blob.text());
  } else {
    const bitmap = await createImageBitmap(blob).catch(() => null);
    if (bitmap) natural = { width: bitmap.width, height: bitmap.height };
  }
  const size = fitIcon(natural);
  return { embedded: { href: await toDataUri(blob), ...size }, readable: { href: path, ...size } };
}

/** Loads every icon once and remembers it. Icons that cannot be loaded map to null. */
export async function loadIcons(refs: Iterable<string>): Promise<Map<string, LoadedIcon | null>> {
  const unique = [...new Set(refs)];
  const loaded = await Promise.all(
    unique.map((ref) => {
      if (!cache.has(ref)) cache.set(ref, load(ref).catch(() => null));
      return cache.get(ref)!;
    }),
  );
  return new Map(unique.map((ref, index) => [ref, loaded[index]]));
}
