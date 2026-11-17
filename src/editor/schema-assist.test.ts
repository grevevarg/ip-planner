import { describe, expect, it } from 'vitest';
import { schemaAt } from './schema-assist';

describe('schemaAt', () => {
  it('follows properties, list items and $refs', () => {
    expect(schemaAt(['sites', 0, 'vlans', 0, 'dhcp', 'mode'])!.enum).toEqual(['server', 'relay', 'none']);
    expect(schemaAt(['diagram', 'layout'])!.enum).toEqual(['dagre', 'elk']);
    expect(schemaAt(['sites', 0, 'supernet'])!.title).toBe('CIDR');
  });

  it('keeps the description written at the point of use', () => {
    expect(String(schemaAt(['sites', 0, 'supernet'])!.description)).toContain('every VLAN and LAN subnet of the site');
  });

  it('looks inside oneOf branches', () => {
    expect(schemaAt(['sites', 0, 'devices', 0, 'interfaces', 0, 'subinterfaces', 0, 'vlan'])!.type).toBe('integer');
  });

  it('returns null outside the schema', () => {
    expect(schemaAt(['nope'])).toBeNull();
    expect(schemaAt(['sites', 0, 'vlans', 0, 'nope', 'deeper'])).toBeNull();
  });
});
