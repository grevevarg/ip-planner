import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze } from '../model/validate';
import { footerText, renderPlan, TABLES } from './plan';

const example = analyze(readFileSync('public/examples/three-companies.yaml', 'utf8'));
const plan = renderPlan(example.model!, example.diagnostics);

/** Text of every cell in the first table with the given id. */
function firstTable(markup: string, id: string): { head: string[]; rows: string[][] } {
  const start = markup.indexOf(`data-table-id="${id}"`);
  const table = markup.slice(markup.indexOf('<table>', start), markup.indexOf('</table>', start));
  const text = (cell: string): string => cell.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const cells = (row: string, tag: string): string[] => [...row.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gs'))].map((m) => text(m[1]));
  const [headRow, ...bodyRows] = table.split('<tr>').slice(1);
  return { head: cells(headRow, 'th'), rows: bodyRows.map((row) => cells(row, 'td')) };
}

describe('renderPlan', () => {
  it('renders the sections in the order of the spec', () => {
    const order = ['plan-cover', 'plan-overview', 'plan-site', 'plan-links', 'plan-tunnels', 'plan-external', 'plan-topology'];
    const positions = order.map((cls) => plan.indexOf(`class="plan-section ${cls}`) + plan.indexOf(`class="${cls}"`) + 1);
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(plan.match(/class="plan-section plan-site"/g)).toHaveLength(3);
  });

  it('shows the cover with title, authors, date, notes and the check summary', () => {
    expect(plan).toContain('<h1>Lab 5 – Linky / SilverCrest / Bluestar</h1>');
    expect(plan).toContain('ntsu');
    expect(plan).toContain('2026-11-16');
    expect(plan).toContain('may not be changed');
    expect(plan).toContain('No problems found');
  });

  it('fills the VLAN table and badges auto values', () => {
    const { head, rows } = firstTable(plan, 'vlans');
    expect(head).toEqual(TABLES.vlans.columns.map((c) => c.label));
    expect(rows[0]).toEqual([
      '10', 'Marknad', '40', '10.10.0.0/26 auto', '255.255.255.192', '10.10.0.1 auto', '10.10.0.63',
      '10.10.0.1 – 10.10.0.62 (62)', 'Server', 'LinkyAB', '10.10.0.2 – 10.10.0.62 auto', '61', '—',
    ]);
    expect(rows[1].slice(3, 12)).toEqual([
      '10.10.1.0/26', '255.255.255.192', '10.10.1.1', '10.10.1.63', '10.10.1.1 – 10.10.1.62 (62)',
      'Relay', '10.10.99.10', '10.10.1.20 – 10.10.1.62 excl. 10.10.1.2-10.10.1.19', '43',
    ]);
  });

  it('lists interfaces with sub-interfaces and what they link to', () => {
    const { rows } = firstTable(plan, 'interfaces');
    expect(rows[0]).toEqual(['LinkyAB', 'f0/0', '—', '203.12.20.30/28', 'wan', 'isp-r1:f0/1']);
    expect(rows[2]).toEqual(['LinkyAB', 'f0/1.10', '10', '10.10.0.1/26 auto', 'lan', '—']);
  });

  it('lists switchports, tunnels and external devices', () => {
    expect(firstTable(plan, 'switchports').rows[0]).toEqual(['Huvudswitch_Linky', 'g0/1', 'Trunk', '10, 20, 99', 'linky-r1:f0/1']);
    const tunnel = firstTable(plan, 'tunnels').rows[0];
    expect(tunnel).toEqual([
      'VPN Linky – Bluestar', 'ipsec-vti', '203.12.20.30 LinkyAB f0/0', '194.50.16.46 Bluestar f0/1',
      '10.255.255.0/30', '10.255.255.1 auto', '10.255.255.2 auto', 'static',
    ]);
    expect(firstTable(plan, 'crypto').rows[0]).toEqual(['VPN Linky – Bluestar', 'IKEv2', 'aes-256', 'sha256', '14', '86,400', 'given by teacher']);
    expect(firstTable(plan, 'external').rows[0]).toEqual(['ISP locked', 'ISP', 'router', 'f0/1', '203.12.20.17/28', 'linky-r1:f0/0']);
    expect(firstTable(plan, 'locked').rows[0]).toEqual(['ISP locked', 'External group', 'Matches the baseline']);
  });

  it('reports utilisation with the free ranges', () => {
    expect(plan).toContain('of 256 addresses in <span class="mono">172.16.100.0/24</span>');
    expect(plan).toContain('<span class="mono">172.16.100.32/27</span> <span class="mono">172.16.100.128/25</span>');
  });

  it('leaves out hidden columns but keeps them in the column menu', () => {
    const narrow = renderPlan(example.model!, example.diagnostics, { hidden: { vlans: ['mask', 'broadcast'] } });
    const { head } = firstTable(narrow, 'vlans');
    expect(head).not.toContain('Mask');
    expect(head).not.toContain('Broadcast');
    expect(head).toContain('Subnet');
    expect(narrow).toContain('<input type="checkbox" data-table="vlans" data-column="mask">');
    expect(narrow).toContain('2 hidden');
  });

  it('escapes text from the file', () => {
    const evil = analyze(`version: 1
meta: { title: "<script>alert(1)</script>" }
sites:
  - id: a
    name: "<img src=x onerror=alert(1)>"
    supernet: 10.0.0.0/24
    vlans: [{ id: 10, name: "<b>x</b>", hosts: 5, notes: "a & b" }]
`);
    const markup = renderPlan(evil.model!, evil.diagnostics);
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(markup).toContain('a &amp; b');
  });

  it('shows warnings on the cover and flags changed locked objects', () => {
    const text = readFileSync('public/examples/three-companies.yaml', 'utf8').replace('- { name: f0/1, address: 203.12.20.17/28 }', '- { name: f0/1, address: 203.12.20.18/28 }');
    const changed = analyze(text);
    const markup = renderPlan(changed.model!, changed.diagnostics);
    expect(markup).toContain('LOCKED_CHANGED');
    expect(firstTable(markup, 'locked').rows[0][2]).toBe('Changed in 1 place');
  });

  it('builds the footer from title and date', () => {
    expect(footerText(example.model!)).toBe('Lab 5 – Linky / SilverCrest / Bluestar, 2026-11-16');
  });
});
