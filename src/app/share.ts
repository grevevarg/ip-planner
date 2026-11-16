/**
 * Share links carry the whole YAML in the URL fragment, compressed with
 * lz-string. Nothing is sent to a server: the fragment never leaves the browser.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const PREFIX = '#y=';

/** Links longer than this get a warning: chat apps and some browsers cut long URLs. */
export const LONG_LINK_CHARS = 8000;

export function shareFragment(text: string): string {
  return PREFIX + compressToEncodedURIComponent(text);
}

/** The YAML carried by a URL fragment, or null if the fragment is not a share link or is damaged. */
export function textFromFragment(fragment: string): string | null {
  if (!fragment.startsWith(PREFIX)) return null;
  try {
    const text = decompressFromEncodedURIComponent(fragment.slice(PREFIX.length));
    return text ? text : null;
  } catch {
    return null;
  }
}
