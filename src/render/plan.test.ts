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
    expect(plan).toContain('<h1>Example – Braintech / Kokonoe Group / Hanabata Cookies</h1>');
    expect(plan).toContain('ntsu');
    expect(plan).toContain('2026-11-16');
    expect(plan).toContain('may not be changed');
    expect(plan).toContain('No problems found');
  });

  it('fills the VLAN table and badges auto values', () => {
    const { head, rows } = firstTable(plan, 'vlans');
    expect(head).toEqual(TABLES.vlans.columns.map((c) => c.label));
    expect(rows[0]).toEqual([
      '10', 'Research', '40', '10.10.0.0/26 auto', '255.255.255.192', '10.10.0.1 auto', '10.10.0.63',
      '10.10.0.1 – 10.10.0.62 (62)', 'Server', 'BT-R1', '10.10.0.2 – 10.10.0.62 auto', '61', '—',
    ]);
    expect(rows[1].slice(3, 12)).toEqual([
      '10.10.1.0/26', '255.255.255.192', '10.10.1.1', '10.10.1.63', '10.10.1.1 – 10.10.1.62 (62)',
      'Relay', '10.10.99.10', '10.10.1.20 – 10.10.1.62 excl. 10.10.1.2-10.10.1.19', '43',
    ]);
  });

  it('lists interfaces with sub-interfaces and what they link to', () => {
    const { rows } = firstTable(plan, 'interfaces');
    expect(rows[0]).toEqual(['BT-R1', 'f0/0', '—', '203.0.113.14/28', 'wan', 'isp-r1:f0/0']);
    expect(rows[2]).toEqual(['BT-R1', 'f0/1.10', '10', '10.10.0.1/26 auto', 'lan', '—']);
  });

  it('lists switchports, tunnels and external devices', () => {
    expect(firstTable(plan, 'switchports').rows[0]).toEqual(['BT-Core', 'g0/1', 'Trunk', '10, 20, 99', 'braintech-r1:f0/1']);
    const tunnel = firstTable(plan, 'tunnels').rows[0];
    expect(tunnel).toEqual([
      'VPN Braintech – Hanabata', 'ipsec-vti', '203.0.113.14 BT-R1 f0/0', '192.0.2.2 HC-R1 f0/0',
      '10.255.255.0/30', '10.255.255.1 auto', '10.255.255.2 auto', 'static',
    ]);
    expect(firstTable(plan, 'crypto').rows[0]).toEqual(['VPN Braintech – Hanabata', 'IKEv2', 'aes-256', 'sha256', '14', '86,400', 'given by teacher']);
    const external = firstTable(plan, 'external').rows;
    expect(external[0]).toEqual(['ISP locked', 'ISP', 'router', 'f0/0', '203.0.113.1/28', 'braintech-r1:f0/0']);
    // A node without interfaces still shows what it is cabled to.
    expect(external[external.length - 1]).toEqual(['ISP', 'Internet', 'cloud', '—', '—', 'isp-r1:f2/0']);
    expect(firstTable(plan, 'locked').rows[0]).toEqual(['ISP locked', 'External group', 'Matches the baseline']);
  });

  /** The markup of one site's section, by its display name. */
  const siteSection = (name: string): string => {
    const start = plan.indexOf(`<h2 class="band"><span>${name}`);
    return plan.slice(start, plan.indexOf('</section>', start));
  };

  it('reports utilisation with the free ranges', () => {
    expect(plan).toContain('of 65,536 addresses in <span class="mono">10.10.0.0/16</span>');
    // Kokonoe: Finance .0/27, Investments .32/27, Legal .64/28, so the next free block is .80/28.
    expect(siteSection('Kokonoe Group')).toContain('<span class="util-free-label">Free ranges</span> <span class="mono">10.20.0.80/28</span> <span class="mono">10.20.0.96/27</span>');
  });

  it('lists every WAN uplink of a site with its name', () => {
    const { head, rows } = firstTable(siteSection('Kokonoe Group'), 'wans');
    expect(head).toEqual(['Uplink', 'Interface', 'Address', 'Gateway', 'NAT', 'Link to']);
    expect(rows).toEqual([
      ['Primary', 'kokonoe-r1:f0/0', '198.51.100.14/28', '198.51.100.1', 'On', 'isp-r1:f0/1'],
      ['Backup', 'kokonoe-r1:f0/1', '198.51.100.18/30', '198.51.100.17', 'On', 'isp-r1:f0/2'],
    ]);
    // Without names the Uplink column is left out.
    expect(firstTable(siteSection('Braintech'), 'wans').head[0]).toBe('Interface');
    const overview = firstTable(plan, 'overview').rows[1];
    expect(overview.slice(2, 5)).toEqual(['198.51.100.14/28 198.51.100.18/30', '198.51.100.1 198.51.100.17', 'On On']);
  });

  it('lists LANs with their router port, and their hosts in the statics and interface tables', () => {
    const hanabata = siteSection('Hanabata Cookies');
    const { head, rows } = firstTable(hanabata, 'lans');
    expect(head).toEqual(TABLES.lans.columns.map((c) => c.label));
    expect(rows[0]).toEqual([
      'Kitchen', 'hanabata-r1:f1/0', '20', '10.30.0.0/27 auto', '255.255.255.224', '10.30.0.1 auto', '10.30.0.31',
      '10.30.0.1 – 10.30.0.30 (30)', 'Server', 'HC-R1', '10.30.0.2 – 10.30.0.30 auto', '29', '—',
    ]);
    expect(firstTable(hanabata, 'statics').rows).toEqual([
      ['Office', 'printer', '10.30.10.5', 'label printer'],
      ['Office', 'nas01', '10.30.10.10', 'file server'],
    ]);
    const interfaces = firstTable(hanabata, 'interfaces').rows;
    expect(interfaces.find((r) => r[1] === 'f2/0')).toEqual(['HC-R1', 'f2/0', 'Office', '10.30.10.1/28 auto', 'lan', 'hanabata-sw-office']);
    expect(interfaces.find((r) => r[1] === 'eth0')).toEqual(['nas01', 'eth0', 'Office', '10.30.10.10/28', '—', 'hanabata-sw-office']);
  });

  it('lists unmanaged switches with their network, inferred or written', () => {
    expect(firstTable(siteSection('Kokonoe Group'), 'unmanaged').rows).toEqual([
      ['Finance switch', 'switch', '10 (Finance) auto', 'kokonoe-sw1:f0/1'],
      ['Investments switch', 'switch', '20 (Investments) auto', 'kokonoe-sw1:f0/2'],
      ['Legal switch', 'switch', '30 (Legal)', 'kokonoe-sw1:f0/3'],
    ]);
    const office = firstTable(siteSection('Hanabata Cookies'), 'unmanaged').rows[2];
    expect(office).toEqual(['Office switch', 'switch', 'Office auto', 'hanabata-r1:f2/0 hanabata-nas:eth0']);
    expect(siteSection('Braintech')).not.toContain('data-table-id="unmanaged"');
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
    const text = readFileSync('public/examples/three-companies.yaml', 'utf8').replace('- { name: f0/0, address: 203.0.113.1/28 }', '- { name: f0/0, address: 203.0.113.2/28 }');
    const changed = analyze(text);
    const markup = renderPlan(changed.model!, changed.diagnostics);
    expect(markup).toContain('LOCKED_CHANGED');
    expect(firstTable(markup, 'locked').rows[0][2]).toBe('Changed in 1 place');
  });

  it('builds the footer from title and date', () => {
    expect(footerText(example.model!)).toBe('Example – Braintech / Kokonoe Group / Hanabata Cookies, 2026-11-16');
  });
});
