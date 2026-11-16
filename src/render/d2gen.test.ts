import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../model/validate';
import { d2Settings, generateD2, quote, type IconInfo } from './d2gen';

const icon = (ref: string): IconInfo => ({ href: `icons/${ref}.svg`, width: 64, height: 64 });
const example = analyze(readFileSync('public/examples/three-companies.yaml', 'utf8')).model!;
const d2 = generateD2(example, { icon });

describe('quote', () => {
  it('escapes quotes, backslashes, newlines and substitutions', () => {
    expect(quote('plain')).toBe('"plain"');
    expect(quote('a "b" \\ c')).toBe('"a \\"b\\" \\\\ c"');
    expect(quote('two\nlines')).toBe('"two\\nlines"');
    expect(quote('${var}')).toBe('"\\${var}"');
  });
});

describe('generateD2', () => {
  it('carries the diagram settings', () => {
    expect(d2).toContain('layout-engine: dagre');
    expect(d2).toContain('theme-id: 0');
    expect(d2).toContain('direction: right');
    expect(d2Settings(example)).toEqual({ layout: 'dagre', themeID: 0, sketch: false, dark: false });
  });

  it('draws each site as a tinted container labelled with name and supernet', () => {
    expect(d2).toContain('"linky": "LinkyAB\\n10.10.0.0/16" {');
    expect(d2).toContain('stroke: "#16a34a"');
    expect(d2).toContain('"bluestar": "Bluestar AB\\n172.16.100.0/24" {');
  });

  it('gives the external group a red dashed border', () => {
    const group = d2.slice(d2.indexOf('"isp": "ISP" {'), d2.indexOf('# Sites'));
    expect(group).toContain('stroke: "#dc2626"');
    expect(group).toContain('stroke-dash: 4');
  });

  it('draws devices as image nodes with their icon', () => {
    expect(d2).toContain('  "linky-r1": "LinkyAB" {\n    shape: image\n    icon: "icons/router.svg"\n    width: 64\n    height: 64\n  }');
    expect(d2).toContain('icon: "icons/l3switch.svg"');
    expect(d2).toContain('icon: "icons/cloud.svg"');
  });

  it('falls back to a plain node when an icon is unavailable', () => {
    const plain = generateD2(example, { icon: () => undefined });
    expect(plain).toContain('  "linky-r1": "LinkyAB"\n');
    expect(plain).not.toContain('shape: image');
  });

  it('labels connection ends with interface and address', () => {
    expect(d2).toContain('"silvercrest"."silvercrest-r1" -- "bluestar"."bluestar-r1": "Nedgrävd kabel\\n10.255.0.0/30" {');
    expect(d2).toContain('source-arrowhead.label: "f0/0 · 10.255.0.1"');
    expect(d2).toContain('target-arrowhead.label: "f0/0 · 10.255.0.2"');
  });

  it('draws WAN uplinks to the interface that owns the gateway', () => {
    expect(d2).toContain('"linky"."linky-r1" -- "isp"."isp-r1": "203.12.20.16/28" {');
    expect(d2).toContain('source-arrowhead.label: "f0/0 · 203.12.20.30"');
    expect(d2).toContain('target-arrowhead.label: "f0/1 · 203.12.20.17"');
  });

  it('labels trunks with their allowed VLANs', () => {
    expect(d2).toContain('"linky"."linky-sw1" -- "linky"."linky-r1": "trunk 10, 20, 99" {');
  });

  it('links to nodes without interfaces', () => {
    expect(d2).toContain('"isp"."isp-r1" -- "isp"."internet" {\n  source-arrowhead.label: "f2/0"');
  });

  it('draws tunnels dashed, coloured and labelled with the tunnel subnet', () => {
    const start = d2.indexOf('# VPN tunnels');
    const tunnel = d2.slice(start);
    expect(tunnel).toContain('"linky"."linky-r1" -- "bluestar"."bluestar-r1": "VPN Linky – Bluestar\\n10.255.255.0/30" {');
    expect(tunnel).toContain('stroke-dash: 5');
    expect(tunnel).toContain('stroke: "#c2410c"');
    expect(tunnel).toContain('source-arrowhead.label: "10.255.255.1"');
  });

  it('names both ends inside the label for ELK, where end labels would pile up', () => {
    const elk = analyze(readFileSync('public/examples/three-companies.yaml', 'utf8').replace('layout: dagre', 'layout: elk')).model!;
    const source = generateD2(elk, { icon });
    expect(source).toContain('layout-engine: elk');
    expect(source).not.toContain('arrowhead.label');
    expect(source).toContain('"linky"."linky-r1" -- "isp"."isp-r1": "LinkyAB f0/0 · 203.12.20.30\\n203.12.20.16/28\\nISP f0/1 · 203.12.20.17" {');
    expect(source).toContain('"LinkyAB 10.255.255.1\\nVPN Linky – Bluestar\\n10.255.255.0/30\\nBluestar 10.255.255.2"');
  });

  it('puts device names beside the icons when the diagram flows up or down', () => {
    expect(d2).not.toContain('label.near');
    const vertical = analyze(readFileSync('public/examples/minimal.yaml', 'utf8')).model!;
    expect(generateD2(vertical, { icon })).toContain('    height: 64\n    label.near: outside-right-center\n  }');
  });

  it('appends extra_d2 verbatim at the end', () => {
    const model = analyze(`version: 1
diagram:
  theme: sketch
  direction: right
  extra_d2: |
    legend: "Dashed = VPN"
    legend.near: bottom-center
sites:
  - { id: a, supernet: 10.0.0.0/24, devices: [{ id: r1, type: router }] }
`).model!;
    const source = generateD2(model, { icon });
    expect(source.trimEnd().endsWith('legend: "Dashed = VPN"\nlegend.near: bottom-center')).toBe(true);
    expect(source).toContain('sketch: true');
    expect(source).toContain('direction: right');
    expect(source).toContain('layout-engine: dagre');
  });

  it('uses a dark paper colour for the dark theme', () => {
    const model = analyze(`version: 1
diagram: { theme: dark }
sites:
  - { id: a, supernet: 10.0.0.0/24, color: "#ffffff" }
`).model!;
    expect(d2Settings(model)).toMatchObject({ themeID: 200, dark: true });
    expect(generateD2(model, { icon })).toContain('fill: "#393947"');
  });

  it('compiles with the real D2 engine', async () => {
    const { D2 } = await import('@terrastruct/d2');
    const engine = new D2();
    const result = await engine.compile({ fs: { index: d2 }, options: { layout: 'dagre' } });
    const svg = await engine.render(result.diagram, result.renderOptions);
    expect(svg).toContain('<svg');
    expect(svg).toContain('Huvudswitch_Linky');
  }, 60_000);
});
