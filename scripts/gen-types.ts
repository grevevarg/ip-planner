/**
 * Generates src/model/types.ts from src/model/schema.json.
 *   npm run gen:types            write the file
 *   tsx scripts/gen-types.ts --check   exit 1 if the committed file is out of date
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const schemaPath = `${root}src/model/schema.json`;
const outPath = `${root}src/model/types.ts`;

/**
 * A `$ref` with sibling keywords (we put a per-use `description` next to every
 * reference) makes the generator emit a fresh alias each time (Slug1, Slug2 …).
 * Wrapping the reference in `allOf` keeps the description as JSDoc on the
 * property while every use points at the one shared type.
 */
function wrapRefs(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(wrapRefs);
  if (typeof node !== 'object' || node === null) return node;
  const entries = Object.entries(node).map(([key, value]) => [key, wrapRefs(value)] as const);
  const copy = Object.fromEntries(entries) as Record<string, unknown>;
  if (typeof copy.$ref === 'string' && Object.keys(copy).length > 1) {
    const { $ref, ...rest } = copy;
    return { ...rest, allOf: [{ $ref }] };
  }
  return copy;
}

const schema = wrapRefs(JSON.parse(await readFile(schemaPath, 'utf8'))) as JSONSchema;
const output = await compile(schema, 'Netplan', {
  additionalProperties: false,
  bannerComment:
    '/* eslint-disable */\n/**\n * GENERATED from src/model/schema.json by scripts/gen-types.ts.\n * Do not edit by hand; run `npm run gen:types`.\n */',
  style: { singleQuote: true, printWidth: 110 },
});

if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => '');
  if (current !== output) {
    console.error('src/model/types.ts is out of date. Run `npm run gen:types` and commit the result.');
    process.exit(1);
  }
  console.log('src/model/types.ts is up to date.');
} else {
  await writeFile(outPath, output);
  console.log(`Wrote ${outPath}`);
}
