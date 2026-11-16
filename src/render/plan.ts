/**
 * Resolved model → the "spreadsheet": HTML tables, one section per site.
 *
 * Pure string building with no DOM access, so it can be unit tested and the
 * same markup serves both the screen and the printed PDF.
 */
import {
  containsSubnet,
  formatIp,
  formatRange,
  formatSubnet,
  freeBlocks,
  usedAddressCount,
  type Cidr,
  type Ip,
  type IpRange,
  type Subnet,
} from '../ip';
import { countBySeverity, type Diagnostic, type Path } from '../model/diagnostics';
import { peerOf, type RDevice, type ResolvedModel, type RSite, type RVlan } from '../model/resolve';

/** Hidden column keys per table id. */
export type HiddenColumns = Record<string, string[]>;

export interface PlanOptions {
  hidden?: HiddenColumns;
}

/** A cell is plain text (escaped for you) or ready-made HTML. */
type Cell = string | { html: string } | undefined;

interface Column {
  key: string;
  label: string;
  /** Monospaced, for addresses and interface names. */
  mono?: boolean;
  /** Right-aligned, for counts. */
  numeric?: boolean;
  /** Leave the column out when no row has a value in it. */
  optional?: boolean;
}

export const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const html = (markup: string): { html: string } => ({ html: markup });
const AUTO = '<span class="badge badge-auto" title="Computed by netplan because the file leaves it out">auto</span>';
const LOCK =
  '<span class="badge badge-lock" title="Marked locked: given, not to be changed"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3.5 5V3.6a2.5 2.5 0 0 1 5 0V5h.6c.5 0 .9.4.9.9v4.2c0 .5-.4.9-.9.9H2.9a.9.9 0 0 1-.9-.9V5.9c0-.5.4-.9.9-.9h.6Zm1.2 0h2.6V3.6a1.3 1.3 0 0 0-2.6 0V5Z" fill="currentColor"/></svg>locked</span>';

const withAuto = (text: string, auto: boolean | undefined): Cell => (auto ? html(`${esc(text)} ${AUTO}`) : text);
const cidrText = (cidr: Cidr): string => `${formatIp(cidr.ip)}/${cidr.prefix}`;
/** `first – last`, allowed to wrap after the dash so that wide tables still fit the page. */
const rangeHtml = (range: IpRange): string =>
  range.start === range.end
    ? formatIp(range.start)
    : `<span class="range">${formatIp(range.start)} –</span> <span class="range">${formatIp(range.end)}</span>`;
const count = (n: number): string => n.toLocaleString('en-US');
const subnetList = (subnets: Subnet[]): Cell =>
  subnets.length ? html(subnets.map((s) => esc(formatSubnet(s))).join('<br>')) : '—';

/** Black or white, whichever reads better on the given hex colour. */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#10161d' : '#ffffff';
}

/** All tables of the plan with their columns, for the column-visibility menus. */
export const TABLES: Record<string, { title: string; columns: Column[] }> = {
  overview: {
    title: 'Addressing overview',
    columns: [
      { key: 'site', label: 'Site' },
      { key: 'supernet', label: 'Supernet', mono: true },
      { key: 'wan', label: 'WAN address', mono: true },
      { key: 'gateway', label: 'WAN gateway', mono: true },
      { key: 'nat', label: 'NAT' },
      { key: 'vlans', label: 'VLANs', numeric: true },
    ],
  },
  vlans: {
    title: 'VLANs',
    columns: [
      { key: 'id', label: 'VLAN', numeric: true },
      { key: 'name', label: 'Name' },
      { key: 'hosts', label: 'Hosts needed', numeric: true },
      { key: 'subnet', label: 'Subnet', mono: true },
      { key: 'mask', label: 'Mask', mono: true },
      { key: 'gateway', label: 'Gateway', mono: true },
      { key: 'broadcast', label: 'Broadcast', mono: true },
      { key: 'usable', label: 'Usable range', mono: true },
      { key: 'dhcp', label: 'DHCP' },
      { key: 'server', label: 'Server / relay', mono: true },
      { key: 'pool', label: 'Pool', mono: true },
      { key: 'poolSize', label: 'Pool size', numeric: true },
      { key: 'notes', label: 'Notes' },
    ],
  },
  statics: {
    title: 'Static assignments',
    columns: [
      { key: 'vlan', label: 'VLAN', numeric: true },
      { key: 'name', label: 'Name' },
      { key: 'ip', label: 'Address', mono: true },
      { key: 'role', label: 'Role' },
    ],
  },
  interfaces: {
    title: 'Interfaces',
    columns: [
      { key: 'device', label: 'Device' },
      { key: 'iface', label: 'Interface', mono: true },
      { key: 'vlan', label: 'VLAN', numeric: true },
      { key: 'address', label: 'Address', mono: true },
      { key: 'role', label: 'Role' },
      { key: 'link', label: 'Link to', mono: true },
      { key: 'description', label: 'Description', optional: true },
    ],
  },
  switchports: {
    title: 'Switchports',
    columns: [
      { key: 'device', label: 'Device' },
      { key: 'ports', label: 'Ports', mono: true },
      { key: 'mode', label: 'Mode' },
      { key: 'vlans', label: 'Access VLAN / allowed VLANs' },
      { key: 'link', label: 'Link to', mono: true },
      { key: 'description', label: 'Description', optional: true },
    ],
  },
  links: {
    title: 'Point-to-point links',
    columns: [
      { key: 'name', label: 'Link' },
      { key: 'subnet', label: 'Subnet', mono: true },
      { key: 'mask', label: 'Mask', mono: true },
      { key: 'a', label: 'End A', mono: true },
      { key: 'aAddress', label: 'Address A', mono: true },
      { key: 'b', label: 'End B', mono: true },
      { key: 'bAddress', label: 'Address B', mono: true },
      { key: 'notes', label: 'Notes', optional: true },
    ],
  },
  tunnels: {
    title: 'Tunnels',
    columns: [
      { key: 'name', label: 'Tunnel' },
      { key: 'type', label: 'Type' },
      { key: 'peerA', label: 'Peer A (public IP)', mono: true },
      { key: 'peerB', label: 'Peer B (public IP)', mono: true },
      { key: 'subnet', label: 'Tunnel subnet', mono: true },
      { key: 'ipA', label: 'Tunnel IP A', mono: true },
      { key: 'ipB', label: 'Tunnel IP B', mono: true },
      { key: 'routing', label: 'Routing' },
      { key: 'notes', label: 'Notes', optional: true },
    ],
  },
  protected: {
    title: 'Protected networks',
    columns: [
      { key: 'name', label: 'Tunnel' },
      { key: 'a', label: 'Behind side A', mono: true },
      { key: 'b', label: 'Behind side B', mono: true },
    ],
  },
  crypto: {
    title: 'Crypto parameters',
    columns: [
      { key: 'name', label: 'Tunnel' },
      { key: 'ike', label: 'IKE' },
      { key: 'encryption', label: 'Encryption' },
      { key: 'integrity', label: 'Integrity' },
      { key: 'dh', label: 'DH group', numeric: true },
      { key: 'lifetime', label: 'Lifetime (s)', numeric: true },
      { key: 'psk', label: 'Pre-shared key' },
    ],
  },
  external: {
    title: 'External devices',
    columns: [
      { key: 'group', label: 'Group' },
      { key: 'device', label: 'Device' },
      { key: 'type', label: 'Type' },
      { key: 'iface', label: 'Interface', mono: true },
      { key: 'address', label: 'Address', mono: true },
      { key: 'link', label: 'Link to', mono: true },
    ],
  },
  locked: {
    title: 'Locked objects',
    columns: [
      { key: 'object', label: 'Object' },
      { key: 'kind', label: 'Kind' },
      { key: 'baseline', label: 'Compared with baseline' },
    ],
  },
};

function renderTable(id: string, rows: Record<string, Cell>[], hidden: HiddenColumns, heading = TABLES[id].title): string {
  if (rows.length === 0) return '';
  const spec = TABLES[id];
  const hiddenKeys = new Set(hidden[id] ?? []);
  const hasValue = (key: string): boolean => rows.some((row) => row[key] !== undefined && row[key] !== '' && row[key] !== '—');
  const present = spec.columns.filter((c) => !c.optional || hasValue(c.key));
  const shown = present.filter((c) => !hiddenKeys.has(c.key));
  const classes = (c: Column): string => [c.mono ? 'addr' : '', c.numeric ? 'num' : ''].filter(Boolean).join(' ');

  const menu = present
    .map(
      (c) =>
        `<label><input type="checkbox" data-table="${id}" data-column="${c.key}"${hiddenKeys.has(c.key) ? '' : ' checked'}> ${esc(c.label)}</label>`,
    )
    .join('');
  const head = shown.map((c) => `<th scope="col" class="${classes(c)}">${esc(c.label)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = shown.map((c) => {
        const cell = row[c.key];
        const content = cell === undefined || cell === '' ? '—' : typeof cell === 'string' ? esc(cell) : cell.html;
        return `<td class="${classes(c)}">${content}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
  const hiddenNote = present.length - shown.length;
  return `<div class="plan-table" data-table-id="${id}">
  <div class="plan-table-head">
    <h3>${esc(heading)}</h3>
    <details class="column-menu">
      <summary>Columns${hiddenNote ? ` <span class="column-menu-count">${hiddenNote} hidden</span>` : ''}</summary>
      <div class="column-menu-list">${menu}</div>
    </details>
  </div>
  <div class="table-scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
</div>`;
}

const nameWithLock = (name: string, locked: boolean): Cell => (locked ? html(`${esc(name)} ${LOCK}`) : name);

function vlanRows(site: RSite, model: ResolvedModel): Record<string, Cell>[] {
  return site.vlans.map((vlan) => {
    const info = vlan.info;
    const dhcp = vlan.dhcp;
    const hosts =
      vlan.raw.hosts === undefined
        ? undefined
        : vlan.hostsNeeded !== vlan.raw.hosts
          ? `${vlan.raw.hosts} (+${vlan.raw.growth_percent}% → ${vlan.hostsNeeded})`
          : String(vlan.raw.hosts);
    let server: Cell;
    if (dhcp?.mode === 'server') server = dhcp.on ? (model.devices.get(dhcp.on)?.name ?? dhcp.on) : dhcp.server !== undefined ? formatIp(dhcp.server) : undefined;
    else if (dhcp?.mode === 'relay') server = dhcp.server !== undefined ? formatIp(dhcp.server) : undefined;
    let pool: Cell;
    if (dhcp?.pool) {
      const excluded = dhcp.exclude.length ? `<br><span class="cell-sub">excl. ${dhcp.exclude.map((r) => esc(formatRange(r))).join(', ')}</span>` : '';
      pool = html(`${rangeHtml(dhcp.pool.value)}${dhcp.pool.auto ? ` ${AUTO}` : ''}${excluded}`);
    }
    const notes = [vlan.native ? 'Native VLAN' : '', vlan.raw.notes ?? ''].filter(Boolean).join('. ');
    return {
      id: String(vlan.id),
      name: nameWithLock(vlan.name, vlan.locked),
      hosts,
      subnet: vlan.subnet ? withAuto(formatSubnet(vlan.subnet.value), vlan.subnet.auto) : undefined,
      mask: info ? formatIp(info.mask) : undefined,
      gateway: vlan.gateway ? withAuto(formatIp(vlan.gateway.value), vlan.gateway.auto) : undefined,
      broadcast: info ? formatIp(info.broadcast) : undefined,
      usable:
        info && info.firstUsable !== null && info.lastUsable !== null
          ? html(`${rangeHtml({ start: info.firstUsable, end: info.lastUsable })} <span class="cell-sub">(${count(info.usable)})</span>`)
          : undefined,
      dhcp: dhcp ? { server: 'Server', relay: 'Relay', none: 'None' }[dhcp.mode] : undefined,
      server,
      pool,
      poolSize: dhcp?.pool ? count(dhcp.size) : undefined,
      notes,
    };
  });
}

function interfaceRows(devices: RDevice[], model: ResolvedModel): Record<string, Cell>[] {
  return devices.flatMap((device) =>
    device.interfaces.map((iface, index) => ({
      device: index === 0 ? nameWithLock(device.name, device.locked) : html(`<span class="cell-repeat">${esc(device.name)}</span>`),
      iface: iface.parent ? html(`<span class="subif">${esc(iface.name)}</span>`) : iface.name,
      vlan: iface.vlan === undefined ? undefined : String(iface.vlan),
      address: iface.address ? withAuto(cidrText(iface.address.value), iface.address.auto) : undefined,
      role: iface.role,
      link: peerOf(model, device.id, iface.name),
      description: iface.description,
    })),
  );
}

function switchportRows(site: RSite, model: ResolvedModel): Record<string, Cell>[] {
  const vlanName = (id: number): string => {
    const vlan = site.vlans.find((v) => v.id === id);
    return vlan ? `${id} (${vlan.name})` : String(id);
  };
  return site.devices.flatMap((device) =>
    device.ports.map((port, index) => ({
      device: index === 0 ? nameWithLock(device.name, device.locked) : html(`<span class="cell-repeat">${esc(device.name)}</span>`),
      ports: port.raw.range,
      mode: port.mode === 'trunk' ? 'Trunk' : 'Access',
      vlans:
        port.mode === 'trunk'
          ? port.allowed
            ? withAuto(port.allowed.value.join(', ') || 'none', port.allowed.auto)
            : undefined
          : port.vlan === undefined
            ? undefined
            : vlanName(port.vlan),
      link: peerOf(model, device.id, port.raw.range),
      description: port.raw.description,
    })),
  );
}

function utilisation(site: RSite): string {
  if (!site.supernet) return '';
  const total = 2 ** (32 - site.supernet.prefix);
  const inside = site.vlans.filter((v) => v.subnet && containsSubnet(site.supernet!, v.subnet.value));
  const explicit = inside.filter((v) => !v.subnet!.auto).map((v) => v.subnet!.value);
  const auto = inside.filter((v) => v.subnet!.auto).map((v) => v.subnet!.value);
  const usedExplicit = usedAddressCount(site.supernet, explicit);
  const usedAll = usedAddressCount(site.supernet, [...explicit, ...auto]);
  const usedAuto = usedAll - usedExplicit;
  const free = total - usedAll;
  const pct = (n: number): string => {
    const value = (n / total) * 100;
    if (value === 0 || value === 100) return `${value}%`;
    if (value < 0.1) return '<0.1%';
    if (value > 99.9) return '>99.9%';
    return `${value.toFixed(1)}%`;
  };
  // Segments are proportional, but anything in use stays at least a sliver wide so it is visible.
  const segment = (n: number, cls: string, label: string): string =>
    n === 0 ? '' : `<span class="util-seg ${cls}" style="flex: ${n} 0 ${n === free ? '0' : '3px'}" title="${esc(label)}: ${count(n)} addresses (${pct(n)})"></span>`;
  const blocks = freeBlocks(site.supernet, [...explicit, ...auto]);
  const shown = blocks.slice(0, 48).map((b) => `<span class="mono">${esc(formatSubnet(b))}</span>`);
  const more = blocks.length > shown.length ? ` <span class="cell-sub">and ${blocks.length - shown.length} more</span>` : '';
  return `<div class="plan-util">
  <h3>Address space</h3>
  <div class="util-bar" role="img" aria-label="${esc(`${pct(usedAll)} of ${formatSubnet(site.supernet)} in use`)}">${segment(usedExplicit, 'util-explicit', 'Written in the file')}${segment(usedAuto, 'util-auto', 'Auto-allocated')}${segment(free, 'util-free', 'Free')}</div>
  <ul class="util-legend">
    <li><span class="util-key util-explicit"></span>Written in the file <strong>${count(usedExplicit)}</strong> (${pct(usedExplicit)})</li>
    <li><span class="util-key util-auto"></span>Auto-allocated <strong>${count(usedAuto)}</strong> (${pct(usedAuto)})</li>
    <li><span class="util-key util-free"></span>Free <strong>${count(free)}</strong> (${pct(free)})</li>
    <li class="util-total">of ${count(total)} addresses in <span class="mono">${esc(formatSubnet(site.supernet))}</span></li>
  </ul>
  <p class="util-free-list"><span class="util-free-label">Free ranges</span> ${blocks.length ? shown.join(' ') + more : 'none; the supernet is full'}</p>
</div>`;
}

function siteSection(site: RSite, model: ResolvedModel, hidden: HiddenColumns): string {
  const color = site.color ?? '#51606f';
  const statics = site.vlans.flatMap((vlan: RVlan) =>
    vlan.statics.map((entry) => ({ vlan: String(vlan.id), name: entry.name, ip: formatIp(entry.ip), role: entry.role })),
  );
  const notes = site.raw.notes ? `<p class="plan-notes">${esc(site.raw.notes)}</p>` : '';
  return `<section class="plan-section plan-site" style="--band: ${color}; --band-ink: ${inkOn(color)}">
  <h2 class="band"><span>${esc(site.name)}${site.locked ? ` ${LOCK}` : ''}</span>${site.supernet ? `<span class="band-detail mono">${esc(formatSubnet(site.supernet))}</span>` : ''}</h2>
  ${notes}
  ${renderTable('vlans', vlanRows(site, model), hidden)}
  ${renderTable('statics', statics, hidden)}
  ${renderTable('interfaces', interfaceRows(site.devices, model), hidden)}
  ${renderTable('switchports', switchportRows(site, model), hidden)}
  ${utilisation(site)}
</section>`;
}

const pathStartsWith = (path: Path, prefix: Path): boolean => prefix.every((segment, i) => path[i] === segment);

function lockedRows(model: ResolvedModel, diagnostics: Diagnostic[]): Record<string, Cell>[] {
  const baseline = model.raw.locked_baseline ?? {};
  const rows: Record<string, Cell>[] = [];
  const add = (name: string, kind: string, key: string, path: Path, locked: boolean): void => {
    if (!locked) return;
    const changes = diagnostics.filter((d) => d.code === 'LOCKED_CHANGED' && pathStartsWith(d.path, path)).length;
    const status = !(key in baseline)
      ? 'No baseline to compare with'
      : changes
        ? html(`<span class="status-warn">Changed in ${changes} ${changes === 1 ? 'place' : 'places'}</span>`)
        : 'Matches the baseline';
    rows.push({ object: html(`${esc(name)} ${LOCK}`), kind, baseline: status });
  };
  for (const group of model.external) {
    add(group.name, 'External group', group.id, group.path, group.locked);
    for (const d of group.devices) add(d.name, 'Device', d.id, d.path, d.locked);
  }
  for (const site of model.sites) {
    add(site.name, 'Site', site.id, site.path, site.locked);
    for (const v of site.vlans) add(`${site.name} VLAN ${v.id} ${v.name}`, 'VLAN', `${site.id}:${v.id}`, v.path, v.locked);
    for (const d of site.devices) add(d.name, 'Device', d.id, d.path, d.locked);
  }
  for (const link of model.links) add(link.name, 'Link', link.id, link.path, link.locked);
  for (const tunnel of model.tunnels) add(tunnel.name, 'Tunnel', tunnel.id, tunnel.path, tunnel.locked);
  return rows;
}

function cover(model: ResolvedModel, diagnostics: Diagnostic[]): string {
  const { meta } = model;
  const counts = countBySeverity(diagnostics);
  const facts: string[] = [];
  if (meta.authors?.length) facts.push(`<div><dt>${meta.authors.length === 1 ? 'Author' : 'Authors'}</dt><dd>${esc(meta.authors.join(', '))}</dd></div>`);
  if (meta.date) facts.push(`<div><dt>Date</dt><dd>${esc(meta.date)}</dd></div>`);
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts = [counts.error ? plural(counts.error, 'error') : '', counts.warning ? plural(counts.warning, 'warning') : '', counts.info ? plural(counts.info, 'note') : ''].filter(Boolean);
  const summary = parts.length
    ? `<span class="status-warn">${parts.join(', ')}</span>`
    : '<span class="status-ok">No problems found</span>';
  facts.push(`<div><dt>Checks</dt><dd>${summary}</dd></div>`);
  const list = diagnostics.length
    ? `<ul class="cover-problems">${diagnostics
        .slice(0, 12)
        .map((d) => `<li><span class="mono">${esc(d.code)}</span> line ${d.line}: ${esc(d.message)}</li>`)
        .join('')}${diagnostics.length > 12 ? `<li>and ${diagnostics.length - 12} more</li>` : ''}</ul>`
    : '';
  return `<header class="plan-cover">
  <h1>${esc(meta.title ?? 'Untitled network plan')}</h1>
  <dl class="cover-facts">${facts.join('')}</dl>
  ${meta.notes ? `<p class="plan-notes">${esc(meta.notes.trim())}</p>` : ''}
  ${list}
</header>`;
}

/** Title and date for the running footer of the PDF. */
export function footerText(model: ResolvedModel): string {
  return [model.meta.title ?? 'Untitled network plan', model.meta.date].filter(Boolean).join(', ');
}

export function renderPlan(model: ResolvedModel, diagnostics: Diagnostic[], options: PlanOptions = {}): string {
  const hidden = options.hidden ?? {};
  const ip = (value: Ip | undefined): string | undefined => (value === undefined ? undefined : formatIp(value));

  const overview = model.sites.map((site) => ({
    site: nameWithLock(site.name, site.locked),
    supernet: site.supernet ? formatSubnet(site.supernet) : undefined,
    wan: site.wan?.address ? cidrText(site.wan.address) : undefined,
    gateway: ip(site.wan?.gateway),
    nat: site.wan ? (site.wan.nat ? 'On' : 'Off') : undefined,
    vlans: String(site.vlans.length),
  }));

  const links = model.links.map((link) => ({
    name: nameWithLock(link.name, link.locked),
    subnet: link.subnet ? withAuto(formatSubnet(link.subnet.value), link.subnet.auto) : undefined,
    mask: link.info ? formatIp(link.info.mask) : undefined,
    a: `${link.a.deviceId}:${link.a.ifName}`,
    aAddress: link.a.address ? withAuto(formatIp(link.a.address.value), link.a.address.auto) : undefined,
    b: `${link.b.deviceId}:${link.b.ifName}`,
    bAddress: link.b.address ? withAuto(formatIp(link.b.address.value), link.b.address.auto) : undefined,
    notes: link.raw.notes,
  }));

  const deviceName = (id: string): string => model.devices.get(id)?.name ?? id;
  const tunnels = model.tunnels.map((t) => {
    const peer = (end: typeof t.a): Cell =>
      html(`${esc(end.peerIp === undefined ? '—' : formatIp(end.peerIp))}<br><span class="cell-sub">${esc(deviceName(end.deviceId))} ${esc(end.underlay)}</span>`);
    return {
      name: nameWithLock(t.name, t.locked),
      type: t.type,
      peerA: peer(t.a),
      peerB: peer(t.b),
      subnet: t.subnet ? formatSubnet(t.subnet) : 'none (policy-based)',
      ipA: t.a.address ? withAuto(formatIp(t.a.address.value), t.a.address.auto) : undefined,
      ipB: t.b.address ? withAuto(formatIp(t.b.address.value), t.b.address.auto) : undefined,
      routing: withAuto(t.routing.value, t.routing.auto),
      notes: t.raw.notes,
    };
  });
  const protectedRows = model.tunnels.map((t) => {
    const side = (end: typeof t.a): Cell => {
      const list = subnetList(end.protected.value);
      return end.protected.auto && typeof list === 'object' ? html(`${list.html} ${AUTO}`) : list;
    };
    return { name: t.name, a: side(t.a), b: side(t.b) };
  });
  const crypto = model.tunnels
    .filter((t) => t.crypto)
    .map((t) => ({
      name: t.name,
      ike: t.crypto!.ike === undefined ? undefined : `IKEv${t.crypto!.ike}`,
      encryption: t.crypto!.encryption,
      integrity: t.crypto!.integrity,
      dh: t.crypto!.dh_group === undefined ? undefined : String(t.crypto!.dh_group),
      lifetime: t.crypto!.lifetime_s === undefined ? undefined : count(t.crypto!.lifetime_s),
      psk: t.crypto!.psk_ref,
    }));

  const external = model.external.flatMap((group) =>
    group.devices.flatMap((device, di) => {
      const groupCell = di === 0 ? nameWithLock(group.name, group.locked) : html(`<span class="cell-repeat">${esc(group.name)}</span>`);
      if (device.interfaces.length === 0) {
        return [{ group: groupCell, device: nameWithLock(device.name, device.locked), type: device.type, link: peerOf(model, device.id, '') } as Record<string, Cell>];
      }
      return device.interfaces.map((iface, ii) => ({
        group: di === 0 && ii === 0 ? groupCell : html(`<span class="cell-repeat">${esc(group.name)}</span>`),
        device: ii === 0 ? nameWithLock(device.name, device.locked) : html(`<span class="cell-repeat">${esc(device.name)}</span>`),
        type: ii === 0 ? device.type : undefined,
        iface: iface.name,
        address: iface.address ? cidrText(iface.address.value) : undefined,
        link: peerOf(model, device.id, iface.name),
      }));
    }),
  );
  const externalNotes = model.external
    .filter((g) => g.raw.notes)
    .map((g) => `<p class="plan-notes"><strong>${esc(g.name)}.</strong> ${esc(g.raw.notes!)}</p>`)
    .join('');
  const locked = lockedRows(model, diagnostics);

  const section = (cls: string, title: string, body: string): string =>
    body.trim() ? `<section class="plan-section ${cls}"><h2 class="band">${esc(title)}</h2>${body}</section>` : '';

  return [
    cover(model, diagnostics),
    section('plan-overview', 'Addressing overview', renderTable('overview', overview, hidden, 'All sites')),
    ...model.sites.map((site) => siteSection(site, model, hidden)),
    section('plan-links', 'Links', renderTable('links', links, hidden)),
    section('plan-tunnels', 'VPN tunnels', renderTable('tunnels', tunnels, hidden) + renderTable('protected', protectedRows, hidden) + renderTable('crypto', crypto, hidden)),
    section('plan-external', 'External and locked', externalNotes + renderTable('external', external, hidden) + renderTable('locked', locked, hidden)),
    `<section class="plan-section plan-topology"><h2 class="band">Topology</h2><figure data-topology-slot><p class="plan-empty">The topology diagram is being drawn.</p></figure></section>`,
  ].join('\n');
}
