import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatIp, formatSubnet } from '../ip';
import { freezeYaml } from './freeze';
import { analyze } from './validate';

/**
 * Lines that should carry a diagnostic are tagged with a trailing `# <n>`
 * comment; `at(yaml, n)` gives that line number.
 */
function at(yaml: string, tag: number): number {
  const index = yaml.split('\n').findIndex((line) => line.includes(`# <${tag}>`));
  if (index < 0) throw new Error(`tag <${tag}> not found`);
  return index + 1;
}

/** `CODE@line` for every diagnostic, in document order. */
function found(yaml: string): string[] {
  return analyze(yaml).diagnostics.map((d) => `${d.code}@${d.line}`);
}

function severityOf(yaml: string, code: string): string | undefined {
  return analyze(yaml).diagnostics.find((d) => d.code === code)?.severity;
}

/** Two tunnelled sites with one router each; `extra` strings are spliced in for each test. */
function twoSites(options: { aVlans?: string; bVlans?: string; aDevices?: string; tail?: string; bSupernet?: string } = {}): string {
  return `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: a-r1, interface: wan0, address: 198.51.100.2/30, gateway: 198.51.100.1 }
    vlans:
${options.aVlans ?? '      - { id: 10, hosts: 20 }'}
    devices:
      - id: a-r1
        type: router
        interfaces:
          - { name: wan0, role: wan }
          - { name: lan0, role: trunk, subinterfaces: auto }
${options.aDevices ?? ''}
  - id: b
    supernet: ${options.bSupernet ?? '10.2.0.0/16'}
    wan: { device: b-r1, interface: wan0, address: 203.0.113.2/30, gateway: 203.0.113.1 }
    vlans:
${options.bVlans ?? '      - { id: 10, hosts: 20 }'}
    devices:
      - id: b-r1
        type: router
        interfaces:
          - { name: wan0, role: wan }
          - { name: lan0, role: trunk, subinterfaces: auto }
${options.tail ?? ''}`;
}

const TUNNEL = `tunnels:
  - id: vpn
    type: ipsec-vti
    subnet: 10.255.255.0/30
    a: { device: a-r1, underlay: wan0 }
    b: { device: b-r1, underlay: wan0 }
`;

describe('clean input', () => {
  it('the base fixture has no diagnostics', () => {
    expect(found(twoSites({ tail: TUNNEL }))).toEqual([]);
  });

  it.each(['three-companies.yaml', 'minimal.yaml'])('example %s has no diagnostics', (file) => {
    const analysis = analyze(readFileSync(`public/examples/${file}`, 'utf8'));
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.model).not.toBeNull();
  });
});

describe('YAML_SYNTAX and SCHEMA_*', () => {
  it('reports YAML syntax errors and produces no model', () => {
    const analysis = analyze('version: 1\nsites: [\n');
    expect(analysis.diagnostics[0].code).toBe('YAML_SYNTAX');
    expect(analysis.model).toBeNull();
    expect(analysis.hasErrors).toBe(true);
  });

  it('reports an empty document', () => {
    expect(found('')).toEqual(['SCHEMA_TYPE@1']);
    expect(found('# only a comment\n')).toEqual(['SCHEMA_TYPE@1']);
  });

  it('maps missing required properties to the object that lacks them', () => {
    const yaml = `version: 1
sites:
  - id: a   # <1>
    name: no supernet
`;
    const analysis = analyze(yaml);
    expect(found(yaml)).toEqual([`SCHEMA_REQUIRED@${at(yaml, 1)}`]);
    expect(analysis.diagnostics[0].message).toContain('supernet');
    expect(analysis.model).toBeNull();
  });

  it('points unknown properties at their key', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.0.0.0/8
    supernett: 10.0.0.0/8   # <1>
`;
    expect(found(yaml)).toEqual([`SCHEMA_ADDITIONALPROPERTIES@${at(yaml, 1)}`]);
  });

  it('reports wrong types, enums, patterns and formats on their own lines', () => {
    const yaml = `version: 1
meta:
  date: 16 November   # <1>
diagram:
  layout: tala   # <2>
sites:
  - id: Site_A   # <3>
    supernet: 10.0.0.0/33   # <4>
    vlans:
      - id: ten   # <5>
        gateway: 300.1.1.1   # <6>
`;
    expect(found(yaml)).toEqual([
      `SCHEMA_FORMAT@${at(yaml, 1)}`,
      `SCHEMA_ENUM@${at(yaml, 2)}`,
      `SCHEMA_PATTERN@${at(yaml, 3)}`,
      `SCHEMA_PATTERN@${at(yaml, 4)}`,
      `SCHEMA_TYPE@${at(yaml, 5)}`,
      `SCHEMA_PATTERN@${at(yaml, 6)}`,
    ]);
  });

  it('summarises a failed oneOf in one line', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.0.0.0/8
    devices:
      - id: r1
        type: router
        interfaces:
          - { name: f0/0, subinterfaces: all }   # <1>
          - name: f0/1
            subinterfaces:
              - { vlan: ten }   # <2>
`;
    expect(found(yaml)).toEqual([`SCHEMA_ONEOF@${at(yaml, 1)}`, `SCHEMA_TYPE@${at(yaml, 2)}`]);
  });

  it('rejects a wrong version', () => {
    expect(found('version: 2\n')).toEqual(['SCHEMA_CONST@1']);
  });
});

describe('DUP_ID', () => {
  it('flags ids shared between sites, devices, links and tunnels', () => {
    const yaml = `version: 1
sites:
  - id: core   # <1>
    supernet: 10.0.0.0/16
    devices:
      - { id: core, type: router }   # <2>
      - { id: r2, type: router, interfaces: [{ name: f0/0 }, { name: f0/1 }] }
tunnels:
  - id: core   # <3>
    type: ipsec-policy
    a: { device: r2, underlay: f0/0 }
    b: { device: r2, underlay: f0/1 }
`;
    const codes = found(yaml).filter((c) => c.startsWith('DUP_ID'));
    expect(codes).toEqual([`DUP_ID@${at(yaml, 1)}`, `DUP_ID@${at(yaml, 2)}`, `DUP_ID@${at(yaml, 3)}`]);
  });

  it('flags a VLAN id used twice in one site, but not across sites', () => {
    const yaml = twoSites({
      aVlans: `      - { id: 10, hosts: 20 }   # <1>
      - { id: 10, hosts: 5 }   # <2>`,
    });
    expect(found(yaml).filter((c) => c.startsWith('DUP_ID'))).toEqual([`DUP_ID@${at(yaml, 1)}`, `DUP_ID@${at(yaml, 2)}`]);
  });

  it('flags an interface listed twice on a device', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.0.0.0/16
    devices:
      - id: r1
        type: router
        interfaces:
          - { name: f0/0 }   # <1>
          - { name: f0/0 }   # <2>
`;
    expect(found(yaml)).toEqual([`DUP_ID@${at(yaml, 1)}`, `DUP_ID@${at(yaml, 2)}`]);
  });
});

describe('VLAN_RANGE', () => {
  it('rejects ids outside 1–4094 and the reserved 1002–1005', () => {
    const yaml = twoSites({
      aVlans: `      - { id: 0, hosts: 2 }   # <1>
      - { id: 4095, hosts: 2 }   # <2>
      - { id: 1003, hosts: 2 }   # <3>
      - { id: 4094, hosts: 2 }
      - { id: 1, hosts: 2 }`,
    });
    expect(found(yaml)).toEqual([`VLAN_RANGE@${at(yaml, 1)}`, `VLAN_RANGE@${at(yaml, 2)}`, `VLAN_RANGE@${at(yaml, 3)}`]);
  });
});

describe('REF_UNKNOWN', () => {
  it('flags unknown devices, interfaces and VLANs wherever they are referenced', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: a-r1, interface: nope0, address: 198.51.100.2/30 }   # <1>
    vlans:
      - { id: 10, hosts: 20, dhcp: { mode: server, on: ghost } }   # <2>
    devices:
      - id: a-r1
        type: router
        icon: toaster   # <3>
        interfaces:
          - { name: wan0, link: ghost:f0/0 }   # <4>
          - { name: lan0, vlan: 77, address: 10.1.0.2/27 }   # <5>
          - name: lan1
            subinterfaces:
              - { vlan: 55 }   # <6>
      - id: a-sw1
        type: switch
        ports:
          - { range: f0/1, mode: access, vlan: 30 }   # <7>
          - { range: f0/2, mode: access, vlan: 10, link: a-r1:missing }   # <8>
links:
  - id: l1
    subnet: 10.255.0.0/30
    a: { endpoint: a-r1:wan9 }   # <9>
    b: { endpoint: nobody:f0/0 }   # <10>
tunnels:
  - id: t1
    type: ipsec-policy
    a: { device: a-r1, underlay: tun9 }   # <11>
    b: { device: nobody, underlay: f0/0 }   # <12>
locked_baseline:
  ghost: { id: ghost }   # <13>
`;
    const refs = found(yaml).filter((c) => c.startsWith('REF_UNKNOWN'));
    expect(refs).toEqual(Array.from({ length: 13 }, (_, i) => `REF_UNKNOWN@${at(yaml, i + 1)}`));
  });

  it('requires the WAN device to belong to the site', () => {
    const yaml = twoSites().replace(
      'wan: { device: b-r1, interface: wan0, address: 203.0.113.2/30, gateway: 203.0.113.1 }',
      'wan: { device: a-r1, interface: wan0, address: 203.0.113.2/30 }   # <1>',
    );
    expect(found(yaml)).toContain(`REF_UNKNOWN@${at(yaml, 1)}`);
  });

  it('accepts links to switch ports inside a range and to bare device ids', () => {
    const yaml = `version: 1
external:
  - id: ext
    devices:
      - { id: internet, type: cloud }
      - { id: isp-r1, type: router, interfaces: [{ name: f0/0, link: internet }] }
sites:
  - id: a
    supernet: 10.1.0.0/16
    vlans: [{ id: 10, hosts: 5 }]
    devices:
      - { id: sw, type: switch, ports: [{ range: f0/1-10, mode: access, vlan: 10 }] }
      - { id: pc1, type: pc, interfaces: [{ name: eth0, link: sw:f0/7 }] }
`;
    expect(found(yaml)).toEqual([]);
    expect(found(yaml.replace('sw:f0/7', 'sw:f0/11'))).toHaveLength(1);
  });
});

describe('NOT_NETWORK_ADDR', () => {
  it('flags subnets with host bits set, everywhere a subnet is written', () => {
    const yaml = `version: 1
transit_pool: 10.255.0.1/24   # <1>
sites:
  - id: a
    supernet: 10.1.0.5/16   # <2>
    vlans:
      - { id: 10, subnet: 10.1.1.5/26 }   # <3>
    devices:
      - { id: r1, type: router, interfaces: [{ name: f0/0, address: 192.0.2.1/30 }, { name: f0/1 }, { name: f0/2 }] }
      - { id: r2, type: router, interfaces: [{ name: f0/0, address: 192.0.2.2/30 }, { name: f0/1 }] }
links:
  - id: l1
    subnet: 10.200.0.1/30   # <4>
    a: { endpoint: r1:f0/1, address: 10.200.0.1 }
    b: { endpoint: r2:f0/1, address: 10.200.0.2 }
tunnels:
  - id: t1
    type: gre
    subnet: 10.201.0.2/30   # <5>
    a: { device: r1, underlay: f0/0, address: 10.201.0.1 }
    b: { device: r2, underlay: f0/0, address: 10.201.0.2 }
    protected:
      a: [10.1.1.9/26]   # <6>
      b: [10.9.0.0/24]
`;
    const codes = found(yaml).filter((c) => c.startsWith('NOT_NETWORK_ADDR'));
    expect(codes).toEqual(Array.from({ length: 6 }, (_, i) => `NOT_NETWORK_ADDR@${at(yaml, i + 1)}`));
    expect(analyze(yaml).diagnostics.find((d) => d.line === at(yaml, 3))!.message).toContain('10.1.1.0/26');
  });
});

describe('TOO_SMALL', () => {
  it('flags a subnet with fewer usable addresses than hosts', () => {
    const yaml = twoSites({
      aVlans: `      - { id: 10, hosts: 63, subnet: 10.1.0.0/26 }   # <1>
      - { id: 20, hosts: 62, subnet: 10.1.1.0/26 }`,
    });
    expect(found(yaml)).toEqual([`TOO_SMALL@${at(yaml, 1)}`]);
  });

  it('treats /31 as invalid unless p2p is set, and /32 always', () => {
    const base = (subnet: string, p2p: string): string => `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    vlans:
      - { id: 10, subnet: 10.1.0.0/31 }   # <1>
    devices:
      - { id: r1, type: router, interfaces: [{ name: f0/1 }] }
      - { id: r2, type: router, interfaces: [{ name: f0/1 }] }
links:
  - id: l1
    subnet: ${subnet}   # <2>
${p2p}    a: { endpoint: r1:f0/1 }
    b: { endpoint: r2:f0/1 }
`;
    const plain = base('10.255.0.0/31', '');
    expect(found(plain)).toEqual([`TOO_SMALL@${at(plain, 1)}`, `TOO_SMALL@${at(plain, 2)}`]);

    const p2p = base('10.255.0.0/31', '    p2p: true\n');
    expect(found(p2p)).toEqual([`TOO_SMALL@${at(p2p, 1)}`]);
    const link = analyze(p2p).model!.links[0];
    expect([formatIp(link.a.address!.value), formatIp(link.b.address!.value)]).toEqual(['10.255.0.0', '10.255.0.1']);

    const host = base('10.255.0.0/32', '    p2p: true\n');
    expect(found(host)).toContain(`TOO_SMALL@${at(host, 2)}`);
  });
});

describe('OUTSIDE_SUPERNET', () => {
  it('flags a VLAN subnet outside its site supernet', () => {
    const yaml = twoSites({
      aVlans: `      - { id: 10, subnet: 10.1.0.0/24 }
      - { id: 20, subnet: 10.3.0.0/24 }   # <1>
      - { id: 30, subnet: 10.0.0.0/8 }   # <2>`,
    });
    const codes = found(yaml).filter((c) => c.startsWith('OUTSIDE_SUPERNET'));
    expect(codes).toEqual([`OUTSIDE_SUPERNET@${at(yaml, 1)}`, `OUTSIDE_SUPERNET@${at(yaml, 2)}`]);
  });
});

describe('OVERLAP', () => {
  it('flags the same LAN on both sides of a tunnel, on both lines', () => {
    const yaml = twoSites({
      bSupernet: '10.0.0.0/8',
      aVlans: '      - { id: 10, subnet: 10.1.5.0/24 }   # <1>',
      bVlans: '      - { id: 10, subnet: 10.1.5.128/25 }   # <2>',
      tail: TUNNEL.replace('  - id: vpn', '  - id: vpn   # <3>'),
    });
    expect(found(yaml)).toEqual([`OVERLAP@${at(yaml, 1)}`, `OVERLAP@${at(yaml, 2)}`, `TUNNEL_PROTECTED_OVERLAP@${at(yaml, 3)}`]);
    const messages = analyze(yaml).diagnostics.map((d) => d.message);
    expect(messages[0]).toContain('10.1.5.0/24 (VLAN 10 of a) overlaps 10.1.5.128/25 (VLAN 10 of b)');
  });

  it('checks links, tunnels and directly addressed interfaces against everything else', () => {
    const yaml = twoSites({
      aVlans: '      - { id: 10, subnet: 10.1.0.0/24 }   # <1>',
      aDevices: `      - id: a-r2
        type: router
        interfaces:
          - { name: p0 }
          - { name: lo0, address: 10.1.0.200/32 }   # <2>`,
      tail: `links:
  - id: l1
    subnet: 10.255.255.0/29   # <3>
    a: { endpoint: a-r2:p0, address: 10.255.255.5 }
    b: { endpoint: b-r1:lan0, address: 10.255.255.6 }
${TUNNEL.replace('subnet: 10.255.255.0/30', 'subnet: 10.255.255.0/30   # <4>')}`,
    });
    const codes = found(yaml).filter((c) => c.startsWith('OVERLAP'));
    expect(codes).toEqual([`OVERLAP@${at(yaml, 1)}`, `OVERLAP@${at(yaml, 2)}`, `OVERLAP@${at(yaml, 3)}`, `OVERLAP@${at(yaml, 4)}`]);
  });

  it('does not treat routers sharing one WAN segment as an overlap', () => {
    const yaml = `version: 1
external:
  - id: isp
    devices:
      - { id: isp-r1, type: router, interfaces: [{ name: f0/0, address: 203.0.113.1/28 }] }
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: a-r1, interface: wan0, address: 203.0.113.2/28, gateway: 203.0.113.1 }
    devices: [{ id: a-r1, type: router, interfaces: [{ name: wan0 }] }]
  - id: b
    supernet: 10.2.0.0/16
    wan: { device: b-r1, interface: wan0, address: 203.0.113.3/28, gateway: 203.0.113.1 }
    devices: [{ id: b-r1, type: router, interfaces: [{ name: wan0 }] }]
`;
    expect(found(yaml)).toEqual([]);
    // The same router with the wrong mask sits in a different, overlapping network.
    const wrongMask = yaml.replace('203.0.113.3/28', '203.0.113.3/29');
    const line = wrongMask.split('\n').findIndex((l) => l.includes('203.0.113.3/29')) + 1;
    expect(found(wrongMask)).toContain(`OVERLAP@${line}`);
  });
});

describe('ADDR_NOT_IN_SUBNET and ADDR_RESERVED', () => {
  it('checks gateways, statics, pools, excludes and DHCP servers against the VLAN subnet', () => {
    const yaml = twoSites({
      aVlans: `      - id: 10
        subnet: 10.1.0.0/26
        gateway: 10.1.0.65   # <1>
        static:
          - { name: printer, ip: 10.1.1.9 }   # <2>
          - { name: bcast, ip: 10.1.0.63 }   # <3>
        dhcp:
          mode: server
          server: 10.1.9.9   # <4>
          pool: { start: 10.1.0.0, end: 10.1.0.70 }   # <5>
          exclude:
            - 10.1.0.60-10.1.0.90   # <6>
            - 10.1.0.9-10.1.0.2   # <7>
      - id: 20
        subnet: 10.1.1.0/26
        gateway: 10.1.1.1/24   # <8>
        dhcp:
          mode: server
          pool: { start: 10.1.1.40, end: 10.1.1.20 }   # <9>`,
    });
    const lines = (code: string): number[] => analyze(yaml).diagnostics.filter((d) => d.code === code).map((d) => d.line);
    expect(lines('ADDR_NOT_IN_SUBNET')).toEqual([1, 2, 4, 5, 6, 7, 8, 9].map((n) => at(yaml, n)));
    // <5> holds both pool bounds: the start is the network address, the end is outside.
    expect(lines('ADDR_RESERVED')).toEqual([at(yaml, 3), at(yaml, 5)]);
  });

  it('checks interface, link, tunnel and WAN gateway addresses', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: r1, interface: wan0, address: 198.51.100.2/30, gateway: 198.51.100.9 }   # <1>
    vlans:
      - { id: 10, subnet: 10.1.0.0/26 }
    devices:
      - id: r1
        type: router
        interfaces:
          - { name: wan0 }
          - { name: p0 }
          - { name: lo0, address: 192.0.2.0/24 }   # <2>
          - name: lan0
            subinterfaces:
              - { vlan: 10, address: 10.1.2.1/26 }   # <3>
      - id: srv
        type: server
        interfaces:
          - { name: eth0, vlan: 10, address: 10.1.0.5/24 }   # <4>
          - { name: eth1, vlan: 10, address: 10.1.0.63/26 }   # <5>
      - { id: r2, type: router, interfaces: [{ name: wan0, address: 198.51.100.6/30, role: wan }, { name: p0 }] }
links:
  - id: l1
    subnet: 10.255.0.0/30
    a: { endpoint: r1:p0, address: 10.255.0.9 }   # <6>
    b: { endpoint: r2:p0, address: 10.255.0.3 }   # <7>
tunnels:
  - id: t1
    type: gre
    subnet: 10.255.1.0/30
    a: { device: r1, underlay: wan0, address: 10.255.1.1/24 }   # <8>
    b: { device: r2, underlay: wan0, address: 10.255.2.2 }   # <9>
    protected: { a: [10.1.0.0/26], b: [10.9.0.0/24] }
`;
    const lines = (code: string): number[] => analyze(yaml).diagnostics.filter((d) => d.code === code).map((d) => d.line);
    expect(lines('ADDR_NOT_IN_SUBNET')).toEqual([1, 3, 4, 6, 8, 9].map((n) => at(yaml, n)));
    expect(lines('ADDR_RESERVED')).toEqual([2, 5, 7].map((n) => at(yaml, n)));
  });
});

describe('ADDR_DUP', () => {
  it('flags the same address on two interfaces, or on a static and an unrelated interface', () => {
    const yaml = twoSites({
      aVlans: `      - id: 10
        subnet: 10.1.0.0/26
        static:
          - { name: printer, ip: 10.1.0.10 }   # <1>
          - { name: fileserver, ip: 10.1.0.11 }
          - { name: also-the-gateway, ip: 10.1.0.1 }   # <2>`,
      aDevices: `      - id: srv1
        name: FileServer
        type: server
        interfaces:
          - { name: eth0, vlan: 10, address: 10.1.0.10/26 }   # <3>
          - { name: eth1, vlan: 10, address: 10.1.0.11/26 }`,
    });
    const lines = analyze(yaml).diagnostics.filter((d) => d.code === 'ADDR_DUP').map((d) => d.line);
    // The gateway 10.1.0.1 is held by a-r1:lan0.10 (line of `subinterfaces: auto`) and by the static <2>.
    const subif = yaml.split('\n').findIndex((l) => l.includes('lan0, role: trunk')) + 1;
    expect(lines).toEqual([at(yaml, 1), at(yaml, 2), subif, at(yaml, 3)].sort((x, y) => x - y));
  });

  it('accepts a gateway held by exactly one interface and a static named after its device', () => {
    expect(found(twoSites())).toEqual([]);
  });

  it('flags two routers that both auto-create the gateway sub-interfaces', () => {
    const yaml = twoSites({
      aDevices: `      - id: a-r2
        type: router
        interfaces:
          - { name: lan0, subinterfaces: auto }   # <1>`,
    });
    expect(found(yaml).filter((c) => c.startsWith('ADDR_DUP'))).toContain(`ADDR_DUP@${at(yaml, 1)}`);
  });

  it('flags tunnel ends given the same address', () => {
    const yaml = twoSites({
      tail: TUNNEL.replace('a: { device: a-r1, underlay: wan0 }', 'a: { device: a-r1, underlay: wan0, address: 10.255.255.2 }   # <1>'),
    });
    expect(found(yaml).filter((c) => c.startsWith('ADDR_DUP'))).toContain(`ADDR_DUP@${at(yaml, 1)}`);
  });
});

describe('ADDR_CONFLICT', () => {
  it('flags an interface address that disagrees with the WAN or link that also sets it', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: r1, interface: wan0, address: 198.51.100.2/30 }   # <1>
    devices:
      - { id: r1, type: router, interfaces: [{ name: wan0, address: 198.51.100.6/30 }, { name: p0, address: 10.255.0.5/30 }] }
      - { id: r2, type: router, interfaces: [{ name: p0, address: 10.255.0.2/30 }] }
links:
  - id: l1
    subnet: 10.255.0.0/30
    a: { endpoint: r1:p0 }   # <2>
    b: { endpoint: r2:p0 }
`;
    expect(found(yaml).filter((c) => c.startsWith('ADDR_CONFLICT'))).toEqual([`ADDR_CONFLICT@${at(yaml, 1)}`, `ADDR_CONFLICT@${at(yaml, 2)}`]);
  });

  it('lets the WAN address be written on the interface instead', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: r1, interface: wan0, gateway: 198.51.100.1 }
    devices:
      - { id: r1, type: router, interfaces: [{ name: wan0, address: 198.51.100.2/30 }] }
`;
    const analysis = analyze(yaml);
    expect(analysis.diagnostics).toEqual([]);
    expect(formatSubnet(analysis.model!.sites[0].wans[0].subnet!)).toBe('198.51.100.0/30');
  });
});

describe('STATIC_IN_POOL', () => {
  const vlan = (dhcp: string): string =>
    twoSites({
      aVlans: `      - id: 10
        subnet: 10.1.0.0/26
        static:
          - { name: printer, ip: 10.1.0.30 }   # <1>
        dhcp: ${dhcp}`,
    });

  it('flags a static inside an explicit pool', () => {
    const yaml = vlan('{ mode: server, pool: { start: 10.1.0.20, end: 10.1.0.62 } }');
    expect(found(yaml)).toEqual([`STATIC_IN_POOL@${at(yaml, 1)}`]);
  });

  it('accepts it when excluded, outside the pool, or when the pool is auto', () => {
    expect(found(vlan('{ mode: server, pool: { start: 10.1.0.20, end: 10.1.0.62 }, exclude: [10.1.0.25-10.1.0.35] }'))).toEqual([]);
    expect(found(vlan('{ mode: server, pool: { start: 10.1.0.40, end: 10.1.0.62 } }'))).toEqual([]);
    const auto = analyze(vlan('{ mode: server }'));
    expect(auto.diagnostics).toEqual([]);
    const dhcp = auto.model!.sites[0].vlans[0].dhcp!;
    expect(dhcp.pool!.auto).toBe(true);
    // .2–.62 is 61 addresses; the static at .30 is stepped around.
    expect(dhcp.size).toBe(60);
  });
});

describe('DHCP_RELAY_UNREACHABLE', () => {
  it('warns when the relay server is in no subnet of the site, or is missing', () => {
    const yaml = twoSites({
      aVlans: `      - { id: 10, subnet: 10.1.0.0/26, dhcp: { mode: relay, server: 10.2.0.5 } }   # <1>
      - { id: 20, subnet: 10.1.1.0/26, dhcp: { mode: relay } }   # <2>
      - { id: 30, subnet: 10.1.2.0/26, dhcp: { mode: relay, server: 10.1.0.5 } }`,
    });
    expect(found(yaml)).toEqual([`DHCP_RELAY_UNREACHABLE@${at(yaml, 1)}`, `DHCP_RELAY_UNREACHABLE@${at(yaml, 2)}`]);
    expect(severityOf(yaml, 'DHCP_RELAY_UNREACHABLE')).toBe('warning');
    expect(analyze(yaml).hasErrors).toBe(false);
  });
});

describe('TRUNK_VLAN_MISSING', () => {
  const site = (ports: string): string =>
    twoSites({
      aVlans: `      - { id: 10, hosts: 20 }
      - { id: 20, hosts: 20 }`,
      aDevices: `      - id: a-sw1
        type: switch
        ports:
${ports}`,
    });

  it('warns about allowed VLANs the site does not define', () => {
    const yaml = site(`          - range: g0/1
            mode: trunk
            link: a-r1:lan0
            allowed:
              - 10
              - 20
              - 30   # <1>`);
    expect(found(yaml)).toEqual([`TRUNK_VLAN_MISSING@${at(yaml, 1)}`]);
    expect(severityOf(yaml, 'TRUNK_VLAN_MISSING')).toBe('warning');
  });

  it('warns about access VLANs that no trunk carries to a router', () => {
    const yaml = site(`          - { range: g0/1, mode: trunk, allowed: [10], link: a-r1:lan0 }
          - { range: f0/1-10, mode: access, vlan: 10 }
          - { range: f0/11-20, mode: access, vlan: 20 }   # <1>`);
    expect(found(yaml)).toEqual([`TRUNK_VLAN_MISSING@${at(yaml, 1)}`]);
  });

  it('accepts trunks without an allowed list, links declared on the router side, and SVIs', () => {
    expect(found(site(`          - { range: g0/1, mode: trunk, link: a-r1:lan0 }
          - { range: f0/11-20, mode: access, vlan: 20 }`))).toEqual([]);

    const routerSide = site(`          - { range: g0/1, mode: trunk }
          - { range: f0/11-20, mode: access, vlan: 20 }`).replace(
      '- { name: lan0, role: trunk, subinterfaces: auto }\n      - id: a-sw1',
      '- { name: lan0, role: trunk, subinterfaces: auto, link: a-sw1:g0/1 }\n      - id: a-sw1',
    );
    expect(routerSide).toContain('link: a-sw1:g0/1');
    expect(found(routerSide)).toEqual([]);

    const noUplink = site('          - { range: f0/11-20, mode: access, vlan: 20 }   # <1>');
    expect(found(noUplink)).toEqual([`TRUNK_VLAN_MISSING@${at(noUplink, 1)}`]);
  });
});

describe('TUNNEL_*', () => {
  it('TUNNEL_SUBNET: required for interface-based tunnels, forbidden for ipsec-policy', () => {
    const missing = twoSites({ tail: TUNNEL.replace('    subnet: 10.255.255.0/30\n', '').replace('type: ipsec-vti', 'type: ipsec-vti   # <1>') });
    expect(found(missing)).toEqual([`TUNNEL_SUBNET@${at(missing, 1)}`]);

    const forbidden = twoSites({ tail: TUNNEL.replace('type: ipsec-vti', 'type: ipsec-policy').replace('subnet: 10.255.255.0/30', 'subnet: 10.255.255.0/30   # <1>') });
    expect(found(forbidden)).toEqual([`TUNNEL_SUBNET@${at(forbidden, 1)}`]);

    const policy = twoSites({ tail: TUNNEL.replace('type: ipsec-vti', 'type: ipsec-policy').replace('    subnet: 10.255.255.0/30\n', '') });
    expect(found(policy)).toEqual([]);
    for (const type of ['gre', 'gre-ipsec', 'wireguard']) {
      expect(found(twoSites({ tail: TUNNEL.replace('ipsec-vti', type) }))).toEqual([]);
      expect(found(twoSites({ tail: TUNNEL.replace('ipsec-vti', type).replace('    subnet: 10.255.255.0/30\n', '') }))).toHaveLength(1);
    }
  });

  it('TUNNEL_PEER: the underlay needs an address, and should be a WAN or link interface', () => {
    const noAddress = twoSites({ tail: TUNNEL.replace('a: { device: a-r1, underlay: wan0 }', 'a: { device: a-r1, underlay: lan0 }   # <1>') });
    expect(found(noAddress)).toEqual([`TUNNEL_PEER@${at(noAddress, 1)}`]);
    expect(severityOf(noAddress, 'TUNNEL_PEER')).toBe('error');

    const lan = twoSites({ tail: TUNNEL.replace('a: { device: a-r1, underlay: wan0 }', 'a: { device: a-r1, underlay: lan0.10 }   # <1>') });
    expect(found(lan)).toEqual([`TUNNEL_PEER@${at(lan, 1)}`]);
    expect(severityOf(lan, 'TUNNEL_PEER')).toBe('warning');
  });

  it('TUNNEL_PEER: both ends cannot share one peer address', () => {
    const yaml = twoSites({ tail: TUNNEL.replace('b: { device: b-r1, underlay: wan0 }', 'b: { device: a-r1, underlay: wan0 }   # <1>') });
    expect(found(yaml)).toContain(`TUNNEL_PEER@${at(yaml, 1)}`);
  });

  it('TUNNEL_PROTECTED_OVERLAP: explicit lists are compared too', () => {
    const yaml = twoSites({
      tail: `${TUNNEL}    protected:   # <1>
      a: [10.1.0.0/16]
      b: [10.2.0.0/24, 10.1.200.0/24]
`,
    });
    expect(found(yaml)).toEqual([`TUNNEL_PROTECTED_OVERLAP@${at(yaml, 1)}`]);
    expect(found(yaml.replace(', 10.1.200.0/24', ''))).toEqual([]);
  });

  it('derives peers, tunnel addresses and protected networks', () => {
    const tunnel = analyze(twoSites({ tail: TUNNEL })).model!.tunnels[0];
    expect(formatIp(tunnel.a.peerIp!)).toBe('198.51.100.2');
    expect(formatIp(tunnel.b.peerIp!)).toBe('203.0.113.2');
    expect([formatIp(tunnel.a.address!.value), formatIp(tunnel.b.address!.value)]).toEqual(['10.255.255.1', '10.255.255.2']);
    expect(tunnel.a.address!.auto).toBe(true);
    expect(tunnel.a.protected.value.map(formatSubnet)).toEqual(['10.1.0.0/27']);
    expect(tunnel.b.protected.value.map(formatSubnet)).toEqual(['10.2.0.0/27']);
    expect(tunnel.routing).toEqual({ value: 'static', auto: true });
  });
});

describe('LOCKED_CHANGED', () => {
  const yaml = (address: string, locked = true): string => `version: 1
external:
  - id: isp
    name: ISP
    locked: ${locked}
    devices:
      - id: isp-r1
        type: router
        interfaces:
          - { name: f0/0, address: ${address} }   # <1>
locked_baseline:
  isp:
    id: isp
    name: ISP
    devices:
      - id: isp-r1
        type: router
        interfaces:
          - { name: f0/0, address: 203.0.113.1/28 }
`;

  it('is silent while the locked object matches its baseline', () => {
    expect(found(yaml('203.0.113.1/28'))).toEqual([]);
  });

  it('warns on the changed line', () => {
    const changed = yaml('203.0.113.2/28');
    expect(found(changed)).toEqual([`LOCKED_CHANGED@${at(changed, 1)}`]);
    expect(severityOf(changed, 'LOCKED_CHANGED')).toBe('warning');
    expect(analyze(changed).diagnostics[0].message).toContain('203.0.113.1/28');
  });

  it('ignores objects that are not locked', () => {
    expect(found(yaml('203.0.113.2/28', false))).toEqual([]);
  });

  it('supports VLAN baselines keyed by site:vlan', () => {
    const vlanYaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    vlans:
      - { id: 10, name: Staff, subnet: 10.1.0.0/24, locked: true }   # <1>
locked_baseline:
  a:10: { id: 10, name: Staff, subnet: 10.1.1.0/24 }
`;
    expect(found(vlanYaml)).toEqual([`LOCKED_CHANGED@${at(vlanYaml, 1)}`]);
  });
});

describe('ICON_REMOTE', () => {
  it('warns that remote icons may not print, and accepts repo-relative paths', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    devices:
      - { id: fw1, type: firewall, icon: "https://example.org/fw.svg" }   # <1>
      - { id: fw2, type: firewall, icon: icons/custom/fw.svg }
`;
    expect(found(yaml)).toEqual([`ICON_REMOTE@${at(yaml, 1)}`]);
    expect(severityOf(yaml, 'ICON_REMOTE')).toBe('warning');
  });
});

describe('auto-allocation', () => {
  const site = (vlans: string, extra = ''): string => `version: 1
${extra}sites:
  - id: a
    supernet: 10.10.0.0/24
    vlans:
${vlans}
`;
  const subnets = (yaml: string): Record<number, string> =>
    Object.fromEntries(analyze(yaml).model!.sites[0].vlans.map((v) => [v.id, v.subnet ? formatSubnet(v.subnet.value) : 'none']));

  it('allocates the largest VLANs first, then by VLAN id, and marks them auto', () => {
    const yaml = site(`      - { id: 30, hosts: 10 }
      - { id: 20, hosts: 50 }
      - { id: 10, hosts: 50 }`);
    expect(subnets(yaml)).toEqual({ 10: '10.10.0.0/26', 20: '10.10.0.64/26', 30: '10.10.0.128/28' });
    const vlan = analyze(yaml).model!.sites[0].vlans[0];
    expect(vlan.subnet!.auto).toBe(true);
    expect(vlan.gateway).toEqual({ value: vlan.info!.firstUsable, auto: true });
  });

  it('gives the same result whatever order the VLANs are listed in', () => {
    const lines = ['      - { id: 30, hosts: 10 }', '      - { id: 20, hosts: 50 }', '      - { id: 10, hosts: 50 }', '      - { id: 40, hosts: 2 }'];
    const forward = subnets(site(lines.join('\n')));
    const backward = subnets(site([...lines].reverse().join('\n')));
    expect(backward).toEqual(forward);
  });

  it('re-flows deterministically when one hosts value changes', () => {
    const before = subnets(site(`      - { id: 10, hosts: 20 }
      - { id: 20, hosts: 20 }
      - { id: 30, hosts: 10 }`));
    expect(before).toEqual({ 10: '10.10.0.0/27', 20: '10.10.0.32/27', 30: '10.10.0.64/28' });
    const after = subnets(site(`      - { id: 10, hosts: 20 }
      - { id: 20, hosts: 60 }
      - { id: 30, hosts: 10 }`));
    expect(after).toEqual({ 10: '10.10.0.64/27', 20: '10.10.0.0/26', 30: '10.10.0.96/28' });
  });

  it('works around explicit subnets and honours growth_percent', () => {
    const yaml = site(`      - { id: 10, subnet: 10.10.0.0/26 }
      - { id: 20, hosts: 25, growth_percent: 20 }
      - { id: 30, hosts: 31 }`);
    // 25 hosts + 20 % = 30 → /27; 31 hosts → /26, placed first.
    expect(subnets(yaml)).toEqual({ 10: '10.10.0.0/26', 20: '10.10.0.128/27', 30: '10.10.0.64/26' });
    expect(analyze(yaml).model!.sites[0].vlans[1].hostsNeeded).toBe(30);
  });

  it('ALLOC_FAILED: reports VLANs that cannot be placed', () => {
    const yaml = site(`      - { id: 10, hosts: 100 }
      - { id: 20, hosts: 100 }
      - { id: 30, hosts: 100 }   # <1>
      - { id: 40, hosts: 300 }   # <2>
      - { id: 50, name: nothing to go on }   # <3>`);
    expect(found(yaml)).toEqual([`ALLOC_FAILED@${at(yaml, 1)}`, `ALLOC_FAILED@${at(yaml, 2)}`, `ALLOC_FAILED@${at(yaml, 3)}`]);
  });

  it('allocates link subnets from transit_pool, and fails without one', () => {
    const devices = `    devices:
      - { id: r1, type: router, interfaces: [{ name: p0 }, { name: p1 }] }
      - { id: r2, type: router, interfaces: [{ name: p0 }, { name: p1 }] }
links:
  - { id: zeta, a: { endpoint: r1:p0 }, b: { endpoint: r2:p0 } }   # <1>
  - { id: alpha, p2p: true, a: { endpoint: r1:p1 }, b: { endpoint: r2:p1 } }   # <2>
`;
    const withPool = site('      - { id: 10, hosts: 10 }', 'transit_pool: 10.255.0.0/29\n') + devices;
    const analysis = analyze(withPool);
    expect(analysis.diagnostics).toEqual([]);
    const [zeta, alpha] = analysis.model!.links;
    expect(formatSubnet(zeta.subnet!.value)).toBe('10.255.0.0/30');
    expect(formatSubnet(alpha.subnet!.value)).toBe('10.255.0.4/31');
    expect(zeta.subnet!.auto).toBe(true);
    const r1 = analysis.model!.devices.get('r1')!;
    expect(r1.interfaces.map((i) => `${i.name}=${formatIp(i.address!.value.ip)}/${i.address!.value.prefix}`)).toEqual(['p0=10.255.0.1/30', 'p1=10.255.0.4/31']);

    const withoutPool = site('      - { id: 10, hosts: 10 }') + devices;
    expect(found(withoutPool)).toEqual([`ALLOC_FAILED@${at(withoutPool, 1)}`, `ALLOC_FAILED@${at(withoutPool, 2)}`]);

    const tooSmall = site('      - { id: 10, hosts: 10 }', 'transit_pool: 10.255.0.0/30\n') + devices;
    expect(found(tooSmall)).toEqual([`ALLOC_FAILED@${at(tooSmall, 2)}`]);
  });
});

describe('freezeYaml', () => {
  it('writes every auto value into the file so nothing is auto afterwards', () => {
    const text = readFileSync('public/examples/three-companies.yaml', 'utf8');
    const before = analyze(text);
    const frozenText = freezeYaml(text, before.model!);
    const after = analyze(frozenText);
    expect(after.diagnostics).toEqual([]);
    expect(frozenText).toContain('# Unmanaged switches have no ports to configure.');

    const snapshot = (analysis: typeof before): unknown =>
      analysis.model!.sites.map((s) => ({
        vlans: [...s.vlans, ...s.lans].map((v) => [v.id, formatSubnet(v.subnet!.value), formatIp(v.gateway!.value), v.dhcp?.size, v.dhcp?.effective]),
        networks: s.devices.map((d) => [d.id, d.vlan?.value, d.lan?.value]),
        interfaces: s.devices.flatMap((d) => d.interfaces.map((i) => [d.id, i.name, i.address?.value])),
      }));
    expect(snapshot(after)).toEqual(snapshot(before));

    const model = after.model!;
    for (const site of model.sites) {
      for (const vlan of [...site.vlans, ...site.lans]) {
        expect(vlan.subnet!.auto).toBe(false);
        expect(vlan.gateway!.auto).toBe(false);
        if (vlan.dhcp?.pool) expect(vlan.dhcp.pool.auto).toBe(false);
      }
      for (const device of site.devices) {
        expect([device.vlan?.auto, device.lan?.auto]).not.toContain(true);
        for (const iface of device.interfaces) if (iface.address) expect(iface.address.auto).toBe(false);
      }
    }
    for (const link of model.links) expect([link.subnet!.auto, link.a.address!.auto, link.b.address!.auto]).toEqual([false, false, false]);
    for (const tunnel of model.tunnels) {
      expect([tunnel.a.address!.auto, tunnel.b.address!.auto, tunnel.a.protected.auto, tunnel.b.protected.auto]).toEqual([false, false, false, false]);
    }
  });

  it('turns statics inside an auto pool into explicit excludes', () => {
    const text = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/24
    vlans:
      - id: 10
        hosts: 20
        static: [{ name: printer, ip: 10.1.0.9 }]
        dhcp: { mode: server }
`;
    const before = analyze(text);
    const after = analyze(freezeYaml(text, before.model!));
    expect(after.diagnostics).toEqual([]);
    expect(after.model!.sites[0].vlans[0].dhcp!.size).toBe(before.model!.sites[0].vlans[0].dhcp!.size);
    expect(after.model!.sites[0].vlans[0].raw.dhcp!.exclude).toEqual(['10.1.0.9']);
  });
});

describe('LANs and WAN lists', () => {
  /** VLANs on a trunk, plus two untagged LANs straight on router ports. */
  const lanSite = (extra: { lans?: string; r1?: string; devices?: string } = {}): string => `version: 1
sites:
  - id: bakery
    supernet: 10.30.0.0/24
    vlans:
      - { id: 100, name: Sales, hosts: 10 }
      - { id: 200, name: Support, hosts: 20 }
    lans:
${extra.lans ?? `      - { id: wifi, name: Wifi, device: r1, interface: f2/0, hosts: 50, dhcp: { mode: server, on: r1 } }
      - id: it
        name: Office
        device: r1
        interface: f1/1
        hosts: 15
        static:
          - { name: www, ip: 10.30.0.110, role: webserver }`}
    devices:
      - id: r1
        type: router
        interfaces:
          - { name: f1/0, role: trunk, subinterfaces: auto }
          - { name: f1/1 }
          - { name: f2/0 }
${extra.r1 ?? ''}
${extra.devices ?? ''}
`;

  it('addresses the router port itself and creates no sub-interfaces for LANs', () => {
    const analysis = analyze(lanSite());
    expect(analysis.diagnostics).toEqual([]);
    const site = analysis.model!.sites[0];
    const subnets = Object.fromEntries([...site.vlans, ...site.lans].map((n) => [n.name, formatSubnet(n.subnet!.value)]));
    // Largest first across VLANs and LANs: Wifi /26, the /27s (VLANs by id, then LANs), then Sales' /28.
    expect(subnets).toEqual({ Wifi: '10.30.0.0/26', Support: '10.30.0.64/27', Office: '10.30.0.96/27', Sales: '10.30.0.128/28' });
    const r1 = analysis.model!.devices.get('r1')!;
    expect(r1.interfaces.map((i) => i.name)).toEqual(['f1/0', 'f1/0.100', 'f1/0.200', 'f1/1', 'f2/0']);
    const f20 = r1.interfaces.find((i) => i.name === 'f2/0')!;
    expect(f20).toMatchObject({ lan: 'wifi', role: 'lan', addressSource: 'lan-gateway' });
    expect(`${formatIp(f20.address!.value.ip)}/${f20.address!.value.prefix}`).toBe('10.30.0.1/26');
    expect(f20.address!.auto).toBe(true);
  });

  it('takes subnet and gateway from an address written on the interface', () => {
    const yaml = lanSite({ lans: '      - { id: it, device: r1, interface: f1/1, hosts: 15 }' }).replace('{ name: f1/1 }', '{ name: f1/1, address: 10.30.0.161/27 }');
    const analysis = analyze(yaml);
    expect(analysis.diagnostics).toEqual([]);
    const lan = analysis.model!.sites[0].lans[0];
    expect([formatSubnet(lan.subnet!.value), formatIp(lan.gateway!.value), lan.subnet!.auto, lan.gateway!.auto]).toEqual(['10.30.0.160/27', '10.30.0.161', false, false]);
  });

  it('reports a LAN gateway that disagrees with the interface address', () => {
    const yaml = lanSite({ lans: '      - { id: it, device: r1, interface: f1/1, subnet: 10.30.0.160/27, gateway: 10.30.0.190 }   # <1>' }).replace(
      '{ name: f1/1 }',
      '{ name: f1/1, address: 10.30.0.161/27 }',
    );
    expect(found(yaml)).toEqual([`ADDR_CONFLICT@${at(yaml, 1)}`]);
  });

  it('checks LAN references and membership', () => {
    const yaml = lanSite({
      lans: `      - { id: it, device: r1, interface: f9/9, hosts: 15 }   # <1>
      - { id: lab, device: elsewhere, interface: f0/0, hosts: 5 }   # <2>`,
      devices: `      - id: srv
        type: server
        interfaces:
          - { name: eth0, lan: nope }   # <3>
          - { name: eth1, lan: it, vlan: 100 }   # <4>`,
    });
    expect(found(yaml)).toEqual([
      `REF_UNKNOWN@${at(yaml, 1)}`,
      `REF_UNKNOWN@${at(yaml, 2)}`,
      `REF_UNKNOWN@${at(yaml, 3)}`,
      `NETWORK_MISMATCH@${at(yaml, 4)}`,
    ]);
  });

  it('checks host and static addresses against the LAN subnet', () => {
    const yaml = lanSite({
      lans: `      - id: it
        device: r1
        interface: f1/1
        subnet: 10.30.0.64/27
        static:
          - { name: www, ip: 10.30.0.200 }   # <1>`,
      devices: `      - id: srv
        type: server
        interfaces:
          - { name: eth0, lan: it, address: 10.30.0.70/27 }
          - { name: eth1, lan: it, address: 10.30.0.130/27 }   # <2>`,
    });
    expect(found(yaml)).toEqual([`ADDR_NOT_IN_SUBNET@${at(yaml, 1)}`, `ADDR_NOT_IN_SUBNET@${at(yaml, 2)}`]);
  });

  it('shares ids with everything else and gives LAN gateways to duplicate checks', () => {
    const yaml = lanSite({
      lans: `      - { id: r1, device: r1, interface: f1/1, subnet: 10.30.0.64/27 }   # <1>`,
      devices: `      - id: srv
        type: server
        interfaces:
          - { name: eth0, lan: r1, address: 10.30.0.65/27 }   # <2>`,
    });
    const codes = found(yaml);
    expect(codes).toContain(`DUP_ID@${at(yaml, 1)}`);
    expect(codes).toContain(`ADDR_DUP@${at(yaml, 2)}`);
  });

  it('does not let a WAN, a LAN and a link share one interface', () => {
    const yaml = `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan: { device: r1, interface: f0/0, address: 198.51.100.2/30 }   # <1>
    lans:
      - { id: office, device: r1, interface: f0/0, hosts: 10 }   # <2>
    devices:
      - { id: r1, type: router, interfaces: [{ name: f0/0 }] }
`;
    expect(found(yaml)).toEqual([`ADDR_CONFLICT@${at(yaml, 1)}`, `ADDR_CONFLICT@${at(yaml, 2)}`]);
  });

  it('accepts a list of WAN uplinks and connects each to its provider', () => {
    const yaml = `version: 1
external:
  - id: isps
    devices:
      - { id: isp-a, type: router, interfaces: [{ name: f0/0, address: 198.51.100.1/30 }] }
      - { id: isp-b, type: router, interfaces: [{ name: f0/0, address: 203.0.113.1/30 }] }
sites:
  - id: a
    supernet: 10.1.0.0/16
    wan:
      - { name: Primary, device: r1, interface: f0/0, address: 198.51.100.2/30, gateway: 198.51.100.1, nat: true }
      - { name: Backup, device: r1, interface: f0/1, address: 203.0.113.2/30, gateway: 203.0.113.1 }
    devices:
      - { id: r1, type: router, interfaces: [{ name: f0/0 }, { name: f0/1 }] }
  - id: b
    supernet: 10.2.0.0/16
    devices:
      - { id: r2, type: router, interfaces: [{ name: f0/0, address: 192.0.2.2/30 }] }
tunnels:
  - { id: t, type: ipsec-policy, a: { device: r1, underlay: f0/1 }, b: { device: r2, underlay: f0/0 } }
`;
    const analysis = analyze(yaml);
    // Only the tunnel's far end (not a WAN) is warned about; the backup uplink counts as WAN.
    expect(analysis.diagnostics.map((d) => [d.code, d.message.includes('r2:f0/0')])).toEqual([['TUNNEL_PEER', true]]);
    const site = analysis.model!.sites[0];
    expect(site.wans.map((w) => [w.name, w.path])).toEqual([
      ['Primary', ['sites', 0, 'wan', 0]],
      ['Backup', ['sites', 0, 'wan', 1]],
    ]);
    const wanLinks = analysis.model!.connections.filter((c) => c.kind === 'wan').map((c) => [c.name, c.a.ifName, c.b.deviceId]);
    expect(wanLinks).toEqual([
      ['Primary', 'f0/0', 'isp-a'],
      ['Backup', 'f0/1', 'isp-b'],
    ]);
  });

  it('names the bad key or item of a malformed wan instead of a generic oneOf message', () => {
    const base = 'version: 1\nsites:\n  - id: a\n    supernet: 10.0.0.0/8\n';
    const messages = (wan: string): string[] => analyze(`${base}${wan}`).diagnostics.map((d) => d.message);
    expect(messages('    wan: { device: r1, interface: f0/0, adress: 1.2.3.4/30 }\n')).toEqual(['Unknown property `adress`']);
    expect(messages('    wan:\n      - { device: r1, interface: f0/0 }\n      - { device: r1 }\n')).toEqual(['Missing required property `interface`']);
    expect(messages('    wan: r1\n')).toEqual(['Must be an object or a list']);
  });

  it('protects LAN subnets through tunnels, freezes LAN values and locks LANs by id', () => {
    const yaml = lanSite({
      lans: `      - { id: it, name: Office, device: r1, interface: f1/1, hosts: 15, locked: true }   # <1>`,
    }).replace(
      'version: 1\n',
      `version: 1
locked_baseline:
  it: { id: it, name: Office, device: r1, interface: f1/1, hosts: 14 }
`,
    );
    const analysis = analyze(yaml);
    expect(analysis.diagnostics.map((d) => d.code)).toEqual(['LOCKED_CHANGED']);

    const frozen = analyze(freezeYaml(yaml, analysis.model!));
    const lan = frozen.model!.sites[0].lans[0];
    expect([lan.subnet!.auto, lan.gateway!.auto, formatSubnet(lan.subnet!.value)]).toEqual([false, false, '10.30.0.32/27']);
  });

  it('includes LAN subnets in auto-protected tunnel networks', () => {
    const yaml = lanSite({ r1: '          - { name: f0/0, address: 198.51.100.2/30, role: wan }' }) +
      `  - id: other
    supernet: 10.9.0.0/16
    devices:
      - { id: r9, type: router, interfaces: [{ name: f0/0, address: 198.51.100.6/30, role: wan }] }
tunnels:
  - { id: t, type: ipsec-policy, a: { device: r1, underlay: f0/0 }, b: { device: r9, underlay: f0/0 } }
`;
    const tunnel = analyze(yaml).model!.tunnels[0];
    expect(tunnel.a.protected.value.map(formatSubnet)).toEqual(['10.30.0.128/28', '10.30.0.64/27', '10.30.0.0/26', '10.30.0.96/27']);
  });
});

describe('unmanaged devices', () => {
  /** One VLAN site (managed switch on a trunk) plus one LAN on a router port; `devices` is spliced in. */
  const site = (devices: string): string => `version: 1
sites:
  - id: a
    supernet: 10.1.0.0/16
    vlans:
      - { id: 10, hosts: 20 }
      - { id: 20, hosts: 20 }
    lans:
      - { id: office, device: r1, interface: f2/0, hosts: 10 }
    devices:
      - id: r1
        type: router
        interfaces:
          - { name: f1/0, role: trunk, subinterfaces: auto }
          - { name: f2/0 }
          - { name: f3/0 }
      - id: sw1
        type: switch
        ports:
          - { range: g0/1, mode: trunk, link: r1:f1/0 }
          - { range: f0/1, mode: access, vlan: 10 }
          - { range: f0/2, mode: access, vlan: 20 }
${devices}
`;
  const networks = (yaml: string): Record<string, unknown> =>
    Object.fromEntries(
      [...analyze(yaml).model!.devices.values()]
        .filter((d) => d.vlan || d.lan)
        .map((d) => [d.id, d.vlan ? [d.vlan.value, d.vlan.auto] : [d.lan!.value, d.lan!.auto]]),
    );

  it('infers the network from the access port or LAN port, also along a chain', () => {
    const yaml = site(`      - { id: u10, type: switch, uplink: sw1:f0/1 }
      - { id: u10b, type: switch, uplink: u10 }
      - { id: uoffice, type: switch, uplink: r1:f2/0 }
      - { id: u20, type: switch, vlan: 20, uplink: sw1:f0/2 }`);
    expect(found(yaml)).toEqual([]);
    expect(networks(yaml)).toEqual({ u10: [10, true], u10b: [10, true], uoffice: ['office', true], u20: [20, false] });
  });

  it('accepts hosts that link to the switch by its id', () => {
    const yaml = site(`      - { id: u10, type: switch, uplink: sw1:f0/1 }
      - id: pc
        type: pc
        interfaces:
          - { name: eth0, vlan: 10, link: u10 }`);
    expect(found(yaml)).toEqual([]);
    expect(analyze(yaml).model!.connections.filter((c) => c.a.deviceId === 'pc' || c.b.deviceId === 'pc')).toHaveLength(1);
  });

  it('warns when the written network differs from the port, or the port is a trunk or a bare router port', () => {
    const yaml = site(`      - { id: u1, type: switch, vlan: 20, uplink: sw1:f0/1 }   # <1>
      - { id: u2, type: switch, uplink: sw1:g0/1 }   # <2>
      - { id: u3, type: switch, vlan: 10, uplink: r1:f3/0 }   # <3>
      - { id: u4, type: switch, lan: office, uplink: r1:f2/0 }`);
    expect(found(yaml)).toEqual([`NETWORK_MISMATCH@${at(yaml, 1)}`, `NETWORK_MISMATCH@${at(yaml, 2)}`, `NETWORK_MISMATCH@${at(yaml, 3)}`]);
    expect(severityOf(yaml, 'NETWORK_MISMATCH')).toBe('warning');
    expect(analyze(yaml).diagnostics[2].message).toContain('use a LAN');
  });

  it('warns about a switch cabled into two networks and leaves it uninferred', () => {
    const yaml = site(`      - id: u1   # <1>
        type: switch
      - id: pc10
        type: pc
        interfaces: [{ name: eth0, vlan: 10, link: u1 }]
      - id: pc20
        type: pc
        interfaces: [{ name: eth0, vlan: 20, link: u1 }]`);
    expect(found(yaml)).toEqual([`NETWORK_MISMATCH@${at(yaml, 1)}`]);
    expect(networks(yaml)).toEqual({});
  });

  it('rejects a device network on managed or routing devices, unknown networks and both at once', () => {
    const yaml = site(`      - id: sw2
        type: switch
        vlan: 10   # <1>
        ports: [{ range: f0/1, mode: access, vlan: 10 }]
      - { id: u1, type: switch, vlan: 77 }   # <2>
      - { id: u2, type: switch, lan: nowhere }   # <3>
      - { id: u3, type: switch, vlan: 10, lan: office }   # <4>
      - { id: u4, type: switch, uplink: sw9:f0/1 }   # <5>`);
    expect(found(yaml)).toEqual([
      `NETWORK_MISMATCH@${at(yaml, 1)}`,
      `REF_UNKNOWN@${at(yaml, 2)}`,
      `REF_UNKNOWN@${at(yaml, 3)}`,
      `NETWORK_MISMATCH@${at(yaml, 4)}`,
      `REF_UNKNOWN@${at(yaml, 5)}`,
    ]);
  });
});
