import { describe, expect, it } from 'vitest';
import schema from '../src/model/schema.json';
import { lintSchema, type JsonSchema } from './schema-lint';

describe('schema documentation rules', () => {
  it('schema.json follows every rule', () => {
    expect(lintSchema(schema as JsonSchema)).toEqual([]);
  });

  it('flags a property without a description', () => {
    const problems = lintSchema({
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    });
    expect(problems).toEqual(['#/properties/a: missing description']);
  });

  it('flags objects that allow unknown properties', () => {
    const problems = lintSchema({ type: 'object', properties: { a: { type: 'string', description: 'x' } } });
    expect(problems).toEqual(['#: object with properties must set additionalProperties: false']);
  });

  it('flags undocumented enum values and oneOf branches', () => {
    const problems = lintSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { description: 'm', enum: ['a', 'b'], 'x-enumDescriptions': { a: 'A' } },
        either: { description: 'e', oneOf: [{ const: 'auto' }, { type: 'array', description: 'list' }] },
      },
    });
    expect(problems).toEqual([
      '#/properties/mode: enum value "b" has no x-enumDescriptions entry',
      '#/properties/either/oneOf/0: missing description',
    ]);
  });

  it('flags $defs without title or description, and looks inside them', () => {
    const problems = lintSchema({
      $defs: {
        thing: { type: 'object', additionalProperties: false, properties: { x: { type: 'integer' } } },
      },
    });
    expect(problems).toEqual([
      '#/$defs/thing: missing title',
      '#/$defs/thing: missing description',
      '#/$defs/thing/properties/x: missing description',
    ]);
  });

  it('checks array items and map values', () => {
    const problems = lintSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        list: { description: 'l', type: 'array', items: { type: 'object', properties: { y: { type: 'string' } } } },
        map: { description: 'm', type: 'object', additionalProperties: { type: 'object' } },
        blob: { description: 'b', type: 'object' },
      },
    });
    expect(problems).toEqual([
      '#/properties/list/items: object with properties must set additionalProperties: false',
      '#/properties/list/items/properties/y: missing description',
      '#/properties/map/additionalProperties: missing description',
      '#/properties/blob: object without properties must describe its values with additionalProperties',
    ]);
  });
});
