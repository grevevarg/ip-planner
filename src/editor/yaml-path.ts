/**
 * Works out where in the document the cursor is, from the text alone.
 *
 * A real YAML parser cannot be used for this because the text is usually
 * half-typed when completion is requested. Instead the block structure is read
 * from indentation, and flow collections (`{ a: 1, b: [` …) on the cursor's
 * own line are scanned character by character.
 */
import type { Path } from '../model/diagnostics';

export interface CursorContext {
  /** Path of the mapping (when typing a key) or of the value (when typing a value). Array indexes are always 0. */
  path: Path;
  /** Whether a key or a value is being typed; `none` inside a comment. */
  mode: 'key' | 'value' | 'none';
  /** What has been typed of it so far. */
  prefix: string;
  /** Offset in the text where `prefix` starts. */
  from: number;
}

interface LineInfo {
  indent: number;
  /** True when the line starts a list item (`- `). */
  item: boolean;
  /** Column where the line's own key starts (after any `- `). */
  keyColumn: number;
  /** The key the line opens, if any. */
  key?: string;
  /** True when something follows the key on the same line. */
  hasValue: boolean;
  blank: boolean;
}

const KEY = /^([A-Za-z_][\w-]*)\s*:(\s|$)/;

function describe(line: string): LineInfo {
  const indent = line.length - line.trimStart().length;
  let rest = line.slice(indent);
  const blank = rest === '' || rest.startsWith('#');
  const item = /^-(\s|$)/.test(rest);
  let keyColumn = indent;
  if (item) {
    const after = rest.slice(1);
    const gap = after.length - after.trimStart().length;
    keyColumn = indent + 1 + gap;
    rest = after.trimStart();
  }
  const match = KEY.exec(rest);
  const value = match ? rest.slice(match[0].length).replace(/\s+#.*$/, '').trim() : '';
  return { indent, item, keyColumn, key: match?.[1], hasValue: value !== '', blank };
}

/** Path of the mapping that a key at `column` on line `lineIndex` would belong to. */
function blockPath(lines: string[], lineIndex: number, column: number, startsItem: boolean): Path {
  const reversed: Path = [];
  let col = column;
  let afterItem = false;
  if (startsItem) {
    reversed.push(0);
    col = lines[lineIndex].length - lines[lineIndex].trimStart().length;
    afterItem = true;
  }
  for (let i = lineIndex - 1; i >= 0 && (col > 0 || afterItem); i--) {
    const info = describe(lines[i]);
    if (info.blank) continue;
    // A parent key may sit at the same column as the `- ` of its list.
    const keyIsParent = info.key !== undefined && !info.hasValue && (info.keyColumn < col || (afterItem && !info.item && info.keyColumn === col));
    if (keyIsParent) {
      reversed.push(info.key!);
      col = info.keyColumn;
      afterItem = false;
    }
    if (info.item && info.indent < col) {
      reversed.push(0);
      col = info.indent;
      afterItem = true;
    } else if (!keyIsParent && info.indent < col && info.key === undefined && !info.item) {
      // A line we do not understand (multi-line scalar, flow continuation): stop guessing.
      break;
    }
  }
  return reversed.reverse();
}

export function cursorContext(text: string, pos: number): CursorContext {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const lines = text.slice(0, lineStart).split('\n');
  lines.pop(); // the empty string after the last newline
  const before = text.slice(lineStart, pos);
  lines.push(before);
  const lineIndex = lines.length - 1;

  const info = describe(before);
  const path = blockPath(lines, lineIndex, info.keyColumn, info.item);

  // Scan the cursor's line for `key:` and flow collections.
  const stack: { bracket: '{' | '['; key?: string }[] = [];
  let pendingKey: string | undefined;
  let token = '';
  let tokenStart = lineStart + info.keyColumn;
  let quote: string | undefined;
  for (let i = info.keyColumn; i < before.length; i++) {
    const ch = before[i];
    const next = before[i + 1];
    if (quote) {
      token += ch;
      if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      token += ch;
    } else if (ch === ':' && (next === undefined || next === ' ') && pendingKey === undefined && stack[stack.length - 1]?.bracket !== '[') {
      pendingKey = token.trim();
      token = '';
      tokenStart = lineStart + i + 1;
    } else if (ch === '{' || ch === '[') {
      stack.push({ bracket: ch, key: pendingKey });
      pendingKey = undefined;
      token = '';
      tokenStart = lineStart + i + 1;
    } else if (ch === '}' || ch === ']') {
      stack.pop();
      pendingKey = undefined;
      token = '';
      tokenStart = lineStart + i + 1;
    } else if (ch === ',' && stack.length) {
      pendingKey = undefined;
      token = '';
      tokenStart = lineStart + i + 1;
    } else if (ch === '#' && (i === 0 || before[i - 1] === ' ')) {
      // Inside a comment: nothing to complete.
      return { path, mode: 'none', prefix: '', from: pos };
    } else {
      token += ch;
    }
  }

  for (const entry of stack) {
    if (entry.key !== undefined) path.push(entry.key);
    if (entry.bracket === '[') path.push(0);
  }
  const lead = token.length - token.trimStart().length;
  const prefix = token.trimStart();
  const from = tokenStart + lead;
  const inList = stack[stack.length - 1]?.bracket === '[';
  if (pendingKey !== undefined) return { path: [...path, pendingKey], mode: 'value', prefix, from };
  if (inList) return { path, mode: 'value', prefix, from };
  return { path, mode: 'key', prefix, from };
}
