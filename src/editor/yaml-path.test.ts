import { describe, expect, it } from 'vitest';
import { cursorContext } from './yaml-path';

/** The cursor is where `|` stands in the sample. */
function at(sample: string): { path: string; mode: string; prefix: string } {
  const pos = sample.indexOf('|');
  const text = sample.replace('|', '');
  const context = cursorContext(text, pos);
  expect(text.slice(context.from, pos)).toBe(context.prefix);
  return { path: context.path.join('/'), mode: context.mode, prefix: context.prefix };
}

describe('cursorContext', () => {
  it('finds top-level keys', () => {
    expect(at('ver|')).toEqual({ path: '', mode: 'key', prefix: 'ver' });
    expect(at('version: 1\n|')).toEqual({ path: '', mode: 'key', prefix: '' });
  });

  it('finds values of block keys', () => {
    expect(at('diagram:\n  layout: el|')).toEqual({ path: 'diagram/layout', mode: 'value', prefix: 'el' });
    expect(at('diagram:\n  layout: |')).toEqual({ path: 'diagram/layout', mode: 'value', prefix: '' });
  });

  it('walks up through nested lists and maps', () => {
    const doc = `sites:
  - id: braintech
    vlans:
      - id: 10
        dhcp:
          mo|`;
    expect(at(doc)).toEqual({ path: 'sites/0/vlans/0/dhcp', mode: 'key', prefix: 'mo' });
  });

  it('handles keys on the same line as the list dash', () => {
    expect(at('sites:\n  - na|')).toEqual({ path: 'sites/0', mode: 'key', prefix: 'na' });
    expect(at('sites:\n  - id: a\n    vlans:\n      - dhcp:\n          mode: |')).toEqual({
      path: 'sites/0/vlans/0/dhcp/mode',
      mode: 'value',
      prefix: '',
    });
  });

  it('handles lists that are not indented under their key', () => {
    expect(at('sites:\n- id: a\n  supernet: 10.0.0.0/8\n  col|')).toEqual({ path: 'sites/0', mode: 'key', prefix: 'col' });
  });

  it('ignores blank lines, comments and sibling keys with values', () => {
    const doc = `sites:
  - id: a
    supernet: 10.0.0.0/8

    # a comment
    devices:
      - id: r1
        type: |`;
    expect(at(doc)).toEqual({ path: 'sites/0/devices/0/type', mode: 'value', prefix: '' });
  });

  it('scans flow maps on the cursor line', () => {
    expect(at('sites:\n  - id: a\n    wan: { device: r1, na|')).toEqual({ path: 'sites/0/wan', mode: 'key', prefix: 'na' });
    expect(at('sites:\n  - id: a\n    vlans:\n      - { id: 10, dhcp: { mode: re|')).toEqual({
      path: 'sites/0/vlans/0/dhcp/mode',
      mode: 'value',
      prefix: 're',
    });
    expect(at('    devices:\n      - id: r1\n        interfaces:\n          - { name: f0/0, role: |')).toEqual({
      path: 'devices/0/interfaces/0/role',
      mode: 'value',
      prefix: '',
    });
  });

  it('scans flow lists', () => {
    expect(at('devices: [{ id: r1, ty|')).toEqual({ path: 'devices/0', mode: 'key', prefix: 'ty' });
    expect(at('meta:\n  authors: [ntsu, |')).toEqual({ path: 'meta/authors/0', mode: 'value', prefix: '' });
  });

  it('does not treat colons inside interface names or quoted strings as keys', () => {
    expect(at('links:\n  - a: { endpoint: r1:f0/0, addr|')).toEqual({ path: 'links/0/a', mode: 'key', prefix: 'addr' });
    expect(at('meta:\n  title: "a: b"\n  da|')).toEqual({ path: 'meta', mode: 'key', prefix: 'da' });
  });

  it('offers nothing inside comments', () => {
    expect(at('version: 1 # ver|').mode).toBe('none');
  });
});
