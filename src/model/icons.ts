/** Icons shipped in public/icons/, usable by bare name (`icon: router`). One per device type. */
export const BUILTIN_ICONS = ['router', 'switch', 'l3switch', 'firewall', 'ap', 'server', 'pc', 'cloud', 'isp'] as const;

export type IconKind = 'builtin' | 'path' | 'remote' | 'unknown';

/**
 * How an `icon:` value is interpreted:
 *  - a built-in name            → public/icons/<name>.svg
 *  - a repo-relative path       → fetched from the site and inlined
 *  - an absolute http(s) URL    → passed through untouched (may not print)
 */
export function classifyIcon(ref: string): IconKind {
  if (/^https?:\/\//i.test(ref)) return 'remote';
  if ((BUILTIN_ICONS as readonly string[]).includes(ref)) return 'builtin';
  if (ref.includes('/') || /\.(svg|png|jpe?g|webp|gif)$/i.test(ref)) return 'path';
  return 'unknown';
}

/** Site-relative path of an icon, or null for remote and unknown icons. */
export function iconPath(ref: string): string | null {
  const kind = classifyIcon(ref);
  if (kind === 'builtin') return `icons/${ref}.svg`;
  if (kind === 'path') return ref.replace(/^\.?\/+/, '');
  return null;
}
