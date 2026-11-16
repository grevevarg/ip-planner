/**
 * Schema-driven autocomplete and hover for the YAML editor. Both read straight
 * from schema.json, so the editor shows the same descriptions as docs/SCHEMA.md.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import type { Path } from '../model/diagnostics';
import rootSchema from '../model/schema.json';
import { cursorContext } from './yaml-path';

type Schema = { [key: string]: unknown };

const isSchema = (value: unknown): value is Schema => typeof value === 'object' && value !== null && !Array.isArray(value);

function deref(node: Schema): Schema {
  if (typeof node.$ref !== 'string') return node;
  const name = node.$ref.replace('#/$defs/', '');
  const target = (rootSchema.$defs as Record<string, Schema>)[name];
  // Keywords written next to the $ref (the per-use description) win over the shared definition.
  return { ...target, ...node, $ref: undefined };
}

/** All shapes a value may take: the schema itself, or each `oneOf` branch. */
function variants(node: Schema): Schema[] {
  const resolved = deref(node);
  if (!Array.isArray(resolved.oneOf)) return [resolved];
  return (resolved.oneOf as Schema[]).map((branch) => ({ description: resolved.description, ...deref(branch) }));
}

/** The schema that governs the value at `path`, or null when the path leaves the schema. */
export function schemaAt(path: Path): Schema | null {
  let current: Schema = rootSchema as Schema;
  for (const segment of path) {
    let next: Schema | undefined;
    for (const variant of variants(current)) {
      if (typeof segment === 'number') {
        if (isSchema(variant.items)) next = variant.items;
      } else if (isSchema(variant.properties) && isSchema(variant.properties[segment])) {
        next = variant.properties[segment] as Schema;
      } else if (isSchema(variant.additionalProperties)) {
        next = variant.additionalProperties;
      }
      if (next) break;
    }
    if (!next) return null;
    current = next;
  }
  return deref(current);
}

function typeLabel(node: Schema): string {
  const resolved = deref(node);
  if ('const' in resolved) return JSON.stringify(resolved.const);
  if (Array.isArray(resolved.enum)) return resolved.enum.join(' | ');
  if (Array.isArray(resolved.oneOf)) return (resolved.oneOf as Schema[]).map(typeLabel).join(' | ');
  if (resolved.type === 'array') return `${isSchema(resolved.items) ? typeLabel(resolved.items) : 'any'}[]`;
  if (typeof resolved.title === 'string') return resolved.title;
  return typeof resolved.type === 'string' ? resolved.type : 'value';
}

function keyCompletions(path: Path): Completion[] {
  const node = schemaAt(path);
  if (!node) return [];
  const out: Completion[] = [];
  for (const variant of variants(node)) {
    if (!isSchema(variant.properties)) continue;
    const required = new Set(Array.isArray(variant.required) ? (variant.required as string[]) : []);
    for (const [name, prop] of Object.entries(variant.properties as Record<string, Schema>)) {
      out.push({
        label: name,
        type: 'property',
        detail: typeLabel(prop) + (required.has(name) ? ' (required)' : ''),
        info: String(deref(prop).description ?? ''),
        apply: `${name}: `,
        boost: required.has(name) ? 1 : 0,
      });
    }
  }
  return out;
}

function valueCompletions(path: Path): Completion[] {
  const node = schemaAt(path);
  if (!node) return [];
  const out: Completion[] = [];
  const seen = new Set<string>();
  const add = (value: unknown, info: string | undefined, boost: number, detail?: string): void => {
    const label = String(value);
    if (seen.has(label)) return;
    seen.add(label);
    out.push({ label, type: 'enum', info, detail, boost });
  };
  for (const variant of variants(node)) {
    const docs = isSchema(variant['x-enumDescriptions']) ? variant['x-enumDescriptions'] : {};
    if (Array.isArray(variant.enum)) {
      for (const value of variant.enum) add(value, docs[String(value)] as string | undefined, 2);
    }
    if ('const' in variant) add(variant.const, variant.description as string | undefined, 2);
    if (variant.type === 'boolean') {
      add('true', undefined, 1);
      add('false', undefined, 1);
    }
    if (Array.isArray(variant.examples)) {
      for (const example of variant.examples) {
        if (typeof example === 'string' || typeof example === 'number') add(example, undefined, 0, 'example');
      }
    }
  }
  return out;
}

/** True when the value has a closed set of choices worth offering unprompted. */
function hasClosedSet(path: Path): boolean {
  const node = schemaAt(path);
  return node !== null && variants(node).some((v) => Array.isArray(v.enum) || 'const' in v || v.type === 'boolean');
}

export function schemaCompletion(context: CompletionContext): CompletionResult | null {
  const cursor = cursorContext(context.state.doc.toString(), context.pos);
  if (cursor.mode === 'none') return null;
  if (!context.explicit && cursor.prefix === '') {
    // Nothing typed yet: only speak up right after `key: ` when there is a closed set to pick from.
    if (cursor.mode === 'key' || !hasClosedSet(cursor.path)) return null;
  }
  const options = cursor.mode === 'key' ? keyCompletions(cursor.path) : valueCompletions(cursor.path);
  if (!options.length) return null;
  return { from: cursor.from, options, validFor: /^[\w./-]*$/ };
}

function tooltipDom(title: string, type: string, lines: string[]): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'cm-schema-hover';
  const head = document.createElement('div');
  head.className = 'cm-schema-hover-head';
  const name = document.createElement('strong');
  name.textContent = title;
  const kind = document.createElement('code');
  kind.textContent = type;
  head.append(name, kind);
  dom.append(head);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    dom.append(p);
  }
  return dom;
}

export const schemaHover = hoverTooltip((view, pos): Tooltip | null => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;
  // The word under the pointer.
  let start = offset;
  let end = offset;
  const wordChar = /[\w-]/;
  while (start > 0 && wordChar.test(text[start - 1])) start--;
  while (end < text.length && wordChar.test(text[end])) end++;
  if (start === end) return null;
  const word = text.slice(start, end);
  const isKey = /^\s*:(\s|$)/.test(text.slice(end));

  const cursor = cursorContext(view.state.doc.toString(), line.from + end);
  if (cursor.mode === 'none') return null;
  const field = String(cursor.path[cursor.path.length - 1] ?? '');
  let dom: HTMLElement | null = null;
  if (isKey && cursor.mode === 'key') {
    const node = schemaAt([...cursor.path, word]);
    if (!node) return null;
    const lines = [String(node.description ?? '')];
    const docs = isSchema(node['x-enumDescriptions']) ? node['x-enumDescriptions'] : null;
    if (docs) for (const [value, doc] of Object.entries(docs)) lines.push(`${value}: ${String(doc)}`);
    if ('default' in node) lines.push(`Default: ${JSON.stringify(node.default)}`);
    dom = tooltipDom(word, typeLabel(node), lines);
  } else if (cursor.mode === 'value') {
    const node = schemaAt(cursor.path);
    if (!node) return null;
    for (const variant of variants(node)) {
      const docs = isSchema(variant['x-enumDescriptions']) ? variant['x-enumDescriptions'] : null;
      if (docs && typeof docs[word] === 'string') dom = tooltipDom(word, field, [docs[word] as string]);
      else if (variant.const === word && typeof variant.description === 'string') dom = tooltipDom(word, field, [variant.description]);
    }
  }
  if (!dom) return null;
  const content = dom;
  return { pos: line.from + start, end: line.from + end, above: true, create: () => ({ dom: content }) };
});
