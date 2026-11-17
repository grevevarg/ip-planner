/**
 * Generates docs/SCHEMA.md from src/model/schema.json.
 *   npm run gen:docs                         write the file
 *   tsx scripts/gen-schema-docs.ts --check   exit 1 if the schema breaks the documentation
 *                                            rules or the committed file is out of date
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { lintSchema, type JsonSchema } from './schema-lint';

const root = fileURLToPath(new URL('..', import.meta.url));
const schemaPath = `${root}src/model/schema.json`;
const examplePath = `${root}public/examples/three-companies.yaml`;
const outPath = `${root}docs/SCHEMA.md`;

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const code = (value: unknown): string => `\`${typeof value === 'string' ? value : JSON.stringify(value)}\``;
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
const anchor = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function renderSchemaDocs(schema: JsonSchema, example: string): string {
  const defs = (isSchema(schema.$defs) ? schema.$defs : {}) as Record<string, JsonSchema>;

  const resolve = (node: JsonSchema): JsonSchema => {
    if (typeof node.$ref !== 'string') return node;
    const name = node.$ref.replace('#/$defs/', '');
    return defs[name];
  };

  /** Short type expression for the Type column, with links to other sections. */
  const typeOf = (node: JsonSchema): string => {
    if (typeof node.$ref === 'string') {
      const target = resolve(node);
      return `[${String(target.title)}](#${anchor(String(target.title))})`;
    }
    if ('const' in node) return code(node.const);
    if (Array.isArray(node.enum)) return node.enum.map(code).join(' \\| ');
    if (Array.isArray(node.oneOf)) return node.oneOf.map((branch) => typeOf(branch as JsonSchema)).join(' \\| ');
    if (node.type === 'array') {
      const items = isSchema(node.items) ? typeOf(node.items) : 'any';
      return items.includes(' ') ? `(${items})[]` : `${items}[]`;
    }
    if (node.type === 'object') {
      return isSchema(node.additionalProperties) ? `map of ${typeOf(node.additionalProperties)}` : 'object';
    }
    if (typeof node.type === 'string') {
      return typeof node.format === 'string' ? `${node.type} (${node.format})` : node.type;
    }
    return 'any';
  };

  /** Description cell: text, enum value docs, oneOf branch docs and examples. */
  const describe = (node: JsonSchema): string => {
    const target = resolve(node);
    const parts: string[] = [String(node.description ?? target.description ?? '')];
    const enumDocs = node['x-enumDescriptions'];
    if (Array.isArray(node.enum) && isSchema(enumDocs)) {
      for (const value of node.enum) parts.push(`• ${code(value)}: ${String(enumDocs[String(value)])}`);
    }
    if (Array.isArray(node.oneOf)) {
      for (const branch of node.oneOf as JsonSchema[]) {
        if (typeof branch.description === 'string') parts.push(`• ${typeOf(branch)}: ${branch.description}`);
      }
    }
    const examples = node.examples;
    if (Array.isArray(examples) && examples.length) {
      parts.push(`Example: ${examples.map(code).join(', ')}`);
    }
    return cell(parts.join('\n'));
  };

  const objectSection = (title: string, node: JsonSchema, level = '##'): string => {
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const lines = [`${level} ${title}`, '', String(node.description ?? ''), ''];
    lines.push('| Field | Type | Required | Default | Description |', '| --- | --- | --- | --- | --- |');
    for (const [name, prop] of Object.entries(node.properties as Record<string, JsonSchema>)) {
      const fallback = 'default' in prop ? prop.default : resolve(prop).default;
      lines.push(
        `| \`${name}\` | ${typeOf(prop)} | ${required.has(name) ? 'yes' : 'no'} | ${
          fallback === undefined ? '' : code(fallback)
        } | ${describe(prop)} |`,
      );
    }
    if (Array.isArray(node.examples) && node.examples.length) {
      lines.push('', 'Example:', '', '```yaml');
      lines.push(stringifyYaml(node.examples[0]).trimEnd(), '```');
    }
    return lines.join('\n');
  };

  const objectDefs = Object.values(defs).filter((def) => isSchema(def.properties));
  const valueDefs = Object.values(defs).filter((def) => !isSchema(def.properties));

  const out: string[] = [];
  out.push('# netplan YAML schema (version 1)', '');
  out.push(
    '> **Generated file.** Produced from `src/model/schema.json` by `scripts/gen-schema-docs.ts`.',
    '> Do not edit it by hand; change the schema and run `npm run gen:docs`.',
    '',
  );
  out.push('## Conventions', '');
  out.push(
    '- **Ids.** Every object has a stable `id` (a lowercase slug) that other parts of the file refer to. `name` is only display text.',
    '- **References.** An interface is referred to as `device-id:interface-name`, for example `hanabata-r1:f0/0`.',
    '- **Addresses.** CIDR notation is used wherever a prefix makes sense (`10.10.1.1/26`).',
    '- **Auto values.** Most derived values are optional. When you leave one out the app computes it and marks it *auto* in the plan. "Copy resolved YAML" writes all auto values into the file so you can freeze them.',
    '- **Locked.** Objects marked `locked: true` are shown with a lock badge. If `locked_baseline` holds the values you were given, any difference is reported as `LOCKED_CHANGED`.',
    '- **No secrets.** Never put pre-shared keys in the file. `crypto.psk_ref` is free text such as "given by teacher".',
    '- **Unknown fields are errors.** Every object rejects properties that are not listed here, so typos are caught.',
    '',
  );
  out.push('## Contents', '');
  out.push(`- [Top level](#top-level)`);
  for (const def of objectDefs) out.push(`- [${String(def.title)}](#${anchor(String(def.title))})`);
  out.push('- [Value types](#value-types)', '- [Full example](#full-example)', '');

  out.push(objectSection('Top level', schema), '');
  for (const def of objectDefs) out.push(objectSection(String(def.title), def), '');

  out.push('## Value types', '', 'Formats used by the fields above.', '');
  for (const def of valueDefs) {
    out.push(`### ${String(def.title)}`, '', String(def.description), '');
    if (Array.isArray(def.oneOf)) {
      for (const branch of def.oneOf as JsonSchema[]) out.push(`- ${typeOf(branch)}: ${String(branch.description)}`);
      out.push('');
    }
    if (typeof def.pattern === 'string') out.push(`Pattern: ${code(def.pattern)}`, '');
    if (Array.isArray(def.examples)) out.push(`Examples: ${def.examples.map(code).join(', ')}`, '');
  }

  out.push('## Full example', '');
  out.push(
    'This is `public/examples/three-companies.yaml`, which is also available under **Load example** in the app. All values are illustrative.',
    '',
    '```yaml',
    example.trimEnd(),
    '```',
    '',
  );
  return out.join('\n');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as JsonSchema;
  const problems = lintSchema(schema);
  if (problems.length) {
    console.error(`schema.json breaks the documentation rules (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  const output = renderSchemaDocs(schema, await readFile(examplePath, 'utf8'));
  if (process.argv.includes('--check')) {
    const current = await readFile(outPath, 'utf8').catch(() => '');
    if (current !== output) {
      console.error('docs/SCHEMA.md is out of date. Run `npm run gen:docs` and commit the result.');
      process.exit(1);
    }
    console.log('Schema is fully documented and docs/SCHEMA.md is up to date.');
  } else {
    await writeFile(outPath, output);
    console.log(`Wrote ${outPath}`);
  }
}
