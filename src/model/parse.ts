import { LineCounter, parseDocument, type Document } from 'yaml';

/** A problem found while reading the YAML text itself (before any schema check). */
export interface SyntaxProblem {
  message: string;
  /** Character offsets into the source text. */
  from: number;
  to: number;
  /** 1-based line number. */
  line: number;
}

export interface ParseResult {
  /** The plain JS value, or undefined when the text is not valid YAML. */
  data: unknown;
  doc: Document.Parsed;
  lineCounter: LineCounter;
  syntax: SyntaxProblem[];
}

export function parseYaml(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const syntax: SyntaxProblem[] = doc.errors.map((e) => ({
    message: e.message,
    from: e.pos[0],
    to: Math.max(e.pos[1], e.pos[0] + 1),
    line: lineCounter.linePos(e.pos[0]).line,
  }));
  const data = syntax.length ? undefined : (doc.toJS() as unknown);
  return { data, doc, lineCounter, syntax };
}
