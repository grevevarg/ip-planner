/**
 * Structural rules every part of schema.json must follow (spec §4.3):
 *  - every property has a description
 *  - every enum value is documented (x-enumDescriptions), every oneOf branch has a description
 *  - every object with properties sets additionalProperties: false
 *  - every $defs entry has a title and a description
 */

export type JsonSchema = { [key: string]: unknown };

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

export function lintSchema(root: JsonSchema): string[] {
  const problems: string[] = [];

  const visit = (schema: JsonSchema, path: string): void => {
    const properties = schema.properties;
    if (isSchema(properties)) {
      if (schema.additionalProperties !== false) {
        problems.push(`${path}: object with properties must set additionalProperties: false`);
      }
      for (const [name, child] of Object.entries(properties)) {
        const childPath = `${path}/properties/${name}`;
        if (!isSchema(child)) {
          problems.push(`${childPath}: property schema must be an object`);
          continue;
        }
        if (!hasText(child.description)) problems.push(`${childPath}: missing description`);
        visit(child, childPath);
      }
    } else if (schema.type === 'object' && !isSchema(schema.additionalProperties) && path.includes('/properties/')) {
      // A free-form object nested inside a map is allowed; anything else must say what it holds.
      if (schema.additionalProperties !== undefined || !path.includes('/additionalProperties')) {
        problems.push(`${path}: object without properties must describe its values with additionalProperties`);
      }
    }

    if (Array.isArray(schema.enum)) {
      const docs = schema['x-enumDescriptions'];
      for (const value of schema.enum) {
        if (!isSchema(docs) || !hasText(docs[String(value)])) {
          problems.push(`${path}: enum value ${JSON.stringify(value)} has no x-enumDescriptions entry`);
        }
      }
    }

    for (const keyword of ['oneOf', 'anyOf'] as const) {
      const branches = schema[keyword];
      if (!Array.isArray(branches)) continue;
      branches.forEach((branch, index) => {
        if (!isSchema(branch)) return;
        if (!hasText(branch.description) && typeof branch.$ref !== 'string') {
          problems.push(`${path}/${keyword}/${index}: missing description`);
        }
        visit(branch, `${path}/${keyword}/${index}`);
      });
    }

    if (isSchema(schema.items)) visit(schema.items, `${path}/items`);
    if (isSchema(schema.additionalProperties)) {
      const child = schema.additionalProperties;
      if (!hasText(child.description)) problems.push(`${path}/additionalProperties: missing description`);
      visit(child, `${path}/additionalProperties`);
    }
  };

  visit(root, '#');
  const defs = root.$defs;
  if (isSchema(defs)) {
    for (const [name, def] of Object.entries(defs)) {
      const path = `#/$defs/${name}`;
      if (!isSchema(def)) continue;
      if (!hasText(def.title)) problems.push(`${path}: missing title`);
      if (!hasText(def.description)) problems.push(`${path}: missing description`);
      visit(def, path);
    }
  }
  return problems;
}
