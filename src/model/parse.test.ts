import { describe, expect, it } from 'vitest';
import { parseYaml } from './parse';

describe('parseYaml', () => {
  it('returns plain data for valid YAML', () => {
    const r = parseYaml('version: 1\nmeta:\n  title: hi\n');
    expect(r.syntax).toEqual([]);
    expect(r.data).toEqual({ version: 1, meta: { title: 'hi' } });
  });

  it('reports syntax errors with a line number', () => {
    const r = parseYaml('version: 1\nmeta: [1, 2\nx: 3\n');
    expect(r.data).toBeUndefined();
    expect(r.syntax.length).toBeGreaterThan(0);
    expect(r.syntax[0].line).toBeGreaterThanOrEqual(2);
  });
});
