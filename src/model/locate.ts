import { isMap, isScalar, type Document, type LineCounter, type Node } from 'yaml';
import type { Path } from './diagnostics';

export interface Span {
  from: number;
  to: number;
  /** 1-based line number of `from`. */
  line: number;
}

/**
 * Maps a path in the parsed data back to a position in the YAML text, so that
 * diagnostics can point at the right line.
 */
export class Locator {
  constructor(
    private readonly doc: Document.Parsed,
    private readonly lineCounter: LineCounter,
    private readonly text: string,
  ) {}

  /**
   * Position of the value at `path`. When the path does not exist (a missing
   * key, for example) the nearest existing ancestor is used. Scalars are
   * spanned exactly; objects and lists are represented by their key, or by
   * their first line, so that underlines stay short.
   */
  span(path: Path): Span {
    for (let depth = path.length; depth >= 0; depth--) {
      const sub = path.slice(0, depth);
      const node = depth === 0 ? this.doc.contents : (this.doc.getIn(sub, true) as Node | undefined);
      if (!node || !node.range) continue;
      if (isScalar(node)) return this.make(node.range[0], node.range[1]);
      const key = this.keyNode(sub);
      if (key?.range) return this.make(key.range[0], key.range[1]);
      return this.firstLine(node.range[0]);
    }
    return this.make(0, Math.min(1, this.text.length));
  }

  /** Position of the key of the last path segment (falls back to `span`). */
  keySpan(path: Path): Span {
    const key = this.keyNode(path);
    return key?.range ? this.make(key.range[0], key.range[1]) : this.span(path);
  }

  private keyNode(path: Path): Node | undefined {
    if (path.length === 0) return undefined;
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length === 0 ? this.doc.contents : this.doc.getIn(parentPath, true);
    if (!isMap(parent)) return undefined;
    const wanted = String(path[path.length - 1]);
    const pair = parent.items.find((item) => isScalar(item.key) && String(item.key.value) === wanted);
    return pair && isScalar(pair.key) ? pair.key : undefined;
  }

  private firstLine(from: number): Span {
    let to = this.text.indexOf('\n', from);
    if (to < 0) to = this.text.length;
    return this.make(from, Math.max(to, from + 1));
  }

  private make(from: number, to: number): Span {
    const end = Math.min(Math.max(to, from + 1), Math.max(this.text.length, from + 1));
    return { from, to: end, line: this.lineCounter.linePos(from).line };
  }
}
