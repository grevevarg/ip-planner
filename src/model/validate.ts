/**
 * Text → diagnostics + resolved model.
 *
 *   YAML syntax  →  JSON Schema (Ajv)  →  resolve  →  semantic checks
 *
 * Each stage only runs when the previous one found no errors, so the semantic
 * checks can rely on the shape of the data. Every diagnostic carries a stable
 * code and the line it belongs to.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import {
  contains,
  containsSubnet,
  formatCidr,
  formatIp,
  formatSubnet,
  isNetworkAddress,
  isReservedAddress,
  overlaps,
  parseCidr,
  parseRange,
  rangeContains,
  sameSubnet,
  toSubnet,
  usableCount,
  type Ip,
  type Subnet,
} from '../ip';
import { SEVERITY, type Diagnostic, type Path, type Report } from './diagnostics';
import { classifyIcon } from './icons';
import { Locator } from './locate';
import { parseYaml, type ParseResult } from './parse';
import {
  deviceLevelPeers,
  endNetworkKey,
  lookupRef,
  networkAt,
  resolve,
  ROUTING_TYPES,
  type EndNetwork,
  type RDevice, type ResolvedModel, type RInterface, type RNetwork, type RSite, type RVlan } from './resolve';
import schema from './schema.json';
import type { Netplan } from './types';

export interface Analysis {
  text: string;
  parse: ParseResult;
  diagnostics: Diagnostic[];
  /** Null when the text is not valid YAML or does not match the schema. */
  model: ResolvedModel | null;
  /** True when at least one diagnostic is an error; the views then keep the last good render. */
  hasErrors: boolean;
}

let compiled: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, verbose: true, strict: true });
    addFormats(ajv);
    ajv.addKeyword('x-enumDescriptions');
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/** Runs the whole pipeline on a YAML string. Never throws. */
export function analyze(text: string): Analysis {
  const parse = parseYaml(text);
  const locator = new Locator(parse.doc, parse.lineCounter, text);
  const diagnostics: Diagnostic[] = [];
  const finish = (model: ResolvedModel | null): Analysis => {
    diagnostics.sort((a, b) => a.from - b.from || a.code.localeCompare(b.code));
    return { text, parse, diagnostics, model, hasErrors: diagnostics.some((d) => d.severity === 'error') };
  };

  if (parse.syntax.length) {
    for (const problem of parse.syntax) {
      diagnostics.push({ code: 'YAML_SYNTAX', severity: 'error', path: [], ...problem });
    }
    return finish(null);
  }
  if (parse.data === null || parse.data === undefined) {
    diagnostics.push({
      code: 'SCHEMA_TYPE',
      severity: 'error',
      message: 'The file is empty. Start with `version: 1`.',
      path: [],
      line: 1,
      from: 0,
      to: Math.min(1, text.length),
    });
    return finish(null);
  }

  const validate = schemaValidator();
  if (!validate(parse.data)) {
    diagnostics.push(...schemaDiagnostics(validate.errors ?? [], parse.data, locator));
    return finish(null);
  }

  const seen = new Set<string>();
  const report: Report = (code, message, path, severity) => {
    const span = locator.span(path);
    const key = `${code}|${span.from}|${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({ code, severity: severity ?? SEVERITY[code], message, path, ...span });
  };
  const model = resolve(parse.data as Netplan, report);
  runChecks(model, report);
  return finish(model);
}

// ── Schema errors ──────────────────────────────────────────────────────────

/** Follows a local `#/$defs/...` reference. */
function derefSchema(node: Record<string, unknown>): Record<string, unknown> {
  if (typeof node.$ref !== 'string') return node;
  const defs = schema.$defs as Record<string, Record<string, unknown>>;
  return defs[node.$ref.replace('#/$defs/', '')] ?? node;
}

function pointerToPath(pointer: string, data: unknown): Path {
  const path: Path = [];
  let current: unknown = data;
  for (const rawSegment of pointer.split('/').slice(1)) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      const index = Number(segment);
      path.push(index);
      current = current[index];
    } else {
      path.push(segment);
      current = typeof current === 'object' && current !== null ? (current as Record<string, unknown>)[segment] : undefined;
    }
  }
  return path;
}

function schemaDiagnostics(errors: ErrorObject[], data: unknown, locator: Locator): Diagnostic[] {
  // A failed `oneOf` also reports why each branch failed. When the value has
  // the shape of exactly one branch (a list, or an object), keep that branch's
  // errors so the bad item or key is named, and drop the other branches'
  // "wrong type" complaints. Otherwise keep one summary line.
  const oneOfs = errors.filter((e) => e.keyword === 'oneOf');
  const dropped = new Set<ErrorObject>();
  const summaries = new Map<ErrorObject, string>();
  for (const oneOf of oneOfs) {
    const nested = errors.filter(
      (e) => e !== oneOf && (e.instancePath === oneOf.instancePath || e.instancePath.startsWith(`${oneOf.instancePath}/`)),
    );
    const branches = ((oneOf.schema ?? []) as Record<string, unknown>[]).map(derefSchema);
    const shape = Array.isArray(oneOf.data) ? 'array' : typeof oneOf.data === 'object' && oneOf.data !== null ? 'object' : null;
    if (shape && branches.filter((b) => b.type === shape).length === 1) {
      dropped.add(oneOf);
      const wrongShape = new Set(['type', 'const', 'enum']);
      for (const e of nested) if (e.instancePath === oneOf.instancePath && wrongShape.has(e.keyword)) dropped.add(e);
    } else {
      for (const e of nested) dropped.add(e);
      const label = (b: Record<string, unknown>): string =>
        'const' in b ? `\`${String(b.const)}\`` : b.type === 'array' ? 'a list' : b.type === 'object' ? 'an object' : String(b.type ?? 'value');
      summaries.set(oneOf, `Must be ${branches.map(label).join(' or ')}`);
    }
  }

  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    if (dropped.has(error)) continue;
    let path = pointerToPath(error.instancePath, data);
    let useKey = false;
    let message = error.message ?? 'is invalid';
    const parent = (error.parentSchema ?? {}) as Record<string, unknown>;
    switch (error.keyword) {
      case 'required':
        message = `Missing required property \`${String(error.params.missingProperty)}\``;
        break;
      case 'additionalProperties':
        path = [...path, String(error.params.additionalProperty)];
        useKey = true;
        message = `Unknown property \`${String(error.params.additionalProperty)}\``;
        break;
      case 'propertyNames':
        continue; // the nested pattern error already names the key
      case 'type':
        message = `Must be ${String(error.params.type)}`;
        break;
      case 'enum':
        message = `Must be one of: ${(error.params.allowedValues as unknown[]).join(', ')}`;
        break;
      case 'const':
        message = `Must be ${JSON.stringify(error.params.allowedValue)}`;
        break;
      case 'oneOf':
        message = summaries.get(error) ?? 'Does not match any allowed form';
        break;
      case 'pattern':
      case 'format': {
        const title = typeof parent.title === 'string' ? parent.title : 'value';
        const example = Array.isArray(parent.examples) ? ` (for example \`${String(parent.examples[0])}\`)` : '';
        message = `Not a valid ${title}${example}`;
        break;
      }
      default:
        message = message.charAt(0).toUpperCase() + message.slice(1);
    }
    const span = useKey ? locator.keySpan(path) : locator.span(path);
    const code = `SCHEMA_${error.keyword.toUpperCase()}`;
    const key = `${code}|${span.from}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, severity: 'error', message, path, ...span });
  }
  return out;
}

// ── Semantic checks ────────────────────────────────────────────────────────

function runChecks(model: ResolvedModel, report: Report): void {
  checkIds(model, report);
  checkVlanRange(model, report);
  checkRefs(model, report);
  checkSubnets(model, report);
  checkOverlap(model, report);
  checkNetworkAddresses(model, report);
  checkInterfaceAddresses(model, report);
  checkDuplicateAddresses(model, report);
  checkTrunks(model, report);
  checkDeviceNetworks(model, report);
  checkTunnels(model, report);
  checkLocked(model, report);
}

const siteOf = (model: ResolvedModel, device: RDevice | undefined): RSite | undefined =>
  device?.siteId ? model.sites.find((s) => s.id === device.siteId) : undefined;

/** VLANs and LANs of a site. */
const networksOf = (site: RSite): RNetwork[] => [...site.vlans, ...site.lans];

function checkIds(model: ResolvedModel, report: Report): void {
  const owners = new Map<string, { what: string; path: Path }[]>();
  const claim = (id: string, what: string, path: Path): void => {
    owners.set(id, [...(owners.get(id) ?? []), { what, path }]);
  };
  const devices = (list: RDevice[]): void => list.forEach((d) => claim(d.id, 'device', d.path));
  for (const group of model.external) {
    claim(group.id, 'external group', group.path);
    devices(group.devices);
  }
  for (const site of model.sites) {
    claim(site.id, 'site', site.path);
    for (const lan of site.lans) claim(lan.id, 'LAN', lan.path);
    devices(site.devices);
  }
  for (const link of model.links) claim(link.id, 'link', link.path);
  for (const tunnel of model.tunnels) claim(tunnel.id, 'tunnel', tunnel.path);
  for (const [id, list] of owners) {
    if (list.length < 2) continue;
    for (const entry of list) {
      const others = list.filter((o) => o !== entry).map((o) => `a ${o.what}`);
      report('DUP_ID', `Id "${id}" is used more than once (also by ${others.join(' and ')}). Ids are shared by sites, LANs, external groups, devices, links and tunnels`, [...entry.path, 'id']);
    }
  }

  for (const site of model.sites) {
    const byId = new Map<number, RVlan[]>();
    for (const vlan of site.vlans) byId.set(vlan.id, [...(byId.get(vlan.id) ?? []), vlan]);
    for (const [id, list] of byId) {
      if (list.length < 2) continue;
      for (const vlan of list) report('DUP_ID', `VLAN ${id} is defined ${list.length} times in site "${site.id}"`, [...vlan.path, 'id']);
    }
  }

  const eachDevice = [...model.sites.flatMap((s) => s.devices), ...model.external.flatMap((g) => g.devices)];
  for (const device of eachDevice) {
    const names = new Map<string, number[]>();
    (device.raw.interfaces ?? []).forEach((iface, index) => names.set(iface.name, [...(names.get(iface.name) ?? []), index]));
    for (const [name, indexes] of names) {
      if (indexes.length < 2) continue;
      for (const index of indexes) {
        report('DUP_ID', `Interface "${name}" is listed ${indexes.length} times on device "${device.id}"`, [...device.path, 'interfaces', index, 'name']);
      }
    }
  }
}

function checkVlanRange(model: ResolvedModel, report: Report): void {
  for (const site of model.sites) {
    for (const vlan of site.vlans) {
      if (vlan.id < 1 || vlan.id > 4094) {
        report('VLAN_RANGE', `VLAN id ${vlan.id} is outside the valid range 1–4094`, [...vlan.path, 'id']);
      } else if (vlan.id >= 1002 && vlan.id <= 1005) {
        report('VLAN_RANGE', `VLAN id ${vlan.id} is reserved (1002–1005 are the legacy FDDI/Token Ring VLANs)`, [...vlan.path, 'id']);
      }
    }
  }
}

function checkRefs(model: ResolvedModel, report: Report): void {
  const checkLinkTarget = (target: string | undefined, path: Path): void => {
    if (!target) return;
    const ref = lookupRef(model, target);
    if (!ref) {
      report('REF_UNKNOWN', `Unknown device "${target.split(':')[0]}" in link target "${target}"`, path);
    } else if (ref.ifName !== undefined && !ref.iface && !ref.port) {
      report('REF_UNKNOWN', `Device "${ref.device.id}" has no interface or port "${ref.ifName}"`, path);
    }
  };

  const eachDevice = [...model.sites.flatMap((s) => s.devices), ...model.external.flatMap((g) => g.devices)];
  for (const device of eachDevice) {
    const site = siteOf(model, device);
    const hasVlan = (id: number): boolean => site?.vlans.some((v) => v.id === id) ?? false;
    const hasLan = (id: string): boolean => site?.lans.some((l) => l.id === id) ?? false;
    const where = site ? `site "${site.id}"` : 'an external group (external devices have no VLANs or LANs)';

    const iconKind = classifyIcon(device.icon);
    if (iconKind === 'unknown') {
      report('REF_UNKNOWN', `Unknown icon "${device.icon}". Use a built-in name, a path such as icons/custom/fw.svg, or an https:// URL`, [...device.path, 'icon']);
    } else if (iconKind === 'remote') {
      report('ICON_REMOTE', `Icon is loaded from another site (${device.icon}); it is not embedded and may be missing from the PDF`, [...device.path, 'icon']);
    }

    (device.raw.interfaces ?? []).forEach((iface, index) => {
      const path = [...device.path, 'interfaces', index];
      checkLinkTarget(iface.link, [...path, 'link']);
      if (iface.vlan !== undefined && !hasVlan(iface.vlan)) {
        report('REF_UNKNOWN', `VLAN ${iface.vlan} is not defined in ${where}`, [...path, 'vlan']);
      }
      if (iface.lan !== undefined && !hasLan(iface.lan)) {
        report('REF_UNKNOWN', `LAN "${iface.lan}" is not defined in ${where}`, [...path, 'lan']);
      }
      if (iface.vlan !== undefined && iface.lan !== undefined) {
        report('NETWORK_MISMATCH', `Interface "${iface.name}" names both VLAN ${iface.vlan} and LAN "${iface.lan}"; it can sit in only one network`, [...path, 'lan'], 'error');
      }
      if (Array.isArray(iface.subinterfaces)) {
        iface.subinterfaces.forEach((sub, si) => {
          if (!hasVlan(sub.vlan)) {
            report('REF_UNKNOWN', `VLAN ${sub.vlan} is not defined in ${where}`, [...path, 'subinterfaces', si, 'vlan']);
          }
        });
      }
    });
    checkLinkTarget(device.raw.uplink, [...device.path, 'uplink']);
    if (device.raw.vlan !== undefined && !hasVlan(device.raw.vlan)) {
      report('REF_UNKNOWN', `VLAN ${device.raw.vlan} is not defined in ${where}`, [...device.path, 'vlan']);
    }
    if (device.raw.lan !== undefined && !hasLan(device.raw.lan)) {
      report('REF_UNKNOWN', `LAN "${device.raw.lan}" is not defined in ${where}`, [...device.path, 'lan']);
    }
    if (device.raw.vlan !== undefined && device.raw.lan !== undefined) {
      report('NETWORK_MISMATCH', `Device "${device.id}" names both VLAN ${device.raw.vlan} and LAN "${device.raw.lan}"; it can sit in only one network`, [...device.path, 'lan'], 'error');
    }
    for (const port of device.ports) {
      checkLinkTarget(port.link, [...port.path, 'link']);
      if (port.mode === 'access' && port.vlan !== undefined && !hasVlan(port.vlan)) {
        report('REF_UNKNOWN', `VLAN ${port.vlan} is not defined in ${where}`, [...port.path, 'vlan']);
      }
    }
  }

  for (const site of model.sites) {
    const attached = [
      ...site.wans.map((wan) => ({ what: 'WAN', ...wan })),
      ...site.lans.map((lan) => ({ what: 'LAN', ...lan })),
    ];
    for (const { what, deviceId, ifName, path } of attached) {
      const device = model.devices.get(deviceId);
      if (!device || device.siteId !== site.id) {
        report('REF_UNKNOWN', `${what} device "${deviceId}" is not a device of site "${site.id}"`, [...path, 'device']);
      } else if (!device.interfaces.some((i) => i.name === ifName)) {
        report('REF_UNKNOWN', `Device "${device.id}" has no interface "${ifName}". List it under the device's \`interfaces\``, [...path, 'interface']);
      }
    }
    for (const net of networksOf(site)) {
      const on = net.dhcp?.on;
      if (on !== undefined && !model.devices.has(on)) {
        report('REF_UNKNOWN', `DHCP server device "${on}" does not exist`, [...net.path, 'dhcp', 'on']);
      }
    }
  }

  // A physical interface can be one WAN uplink, one LAN or one end of one link.
  const users = new Map<string, { what: string; path: Path }[]>();
  const use = (deviceId: string, ifName: string, what: string, path: Path): void => {
    const key = `${deviceId}:${ifName}`;
    users.set(key, [...(users.get(key) ?? []), { what, path }]);
  };
  for (const site of model.sites) {
    site.wans.forEach((wan) => use(wan.deviceId, wan.ifName, `a WAN uplink of site "${site.id}"`, [...wan.path, 'interface']));
    site.lans.forEach((lan) => use(lan.deviceId, lan.ifName, `LAN "${lan.id}"`, [...lan.path, 'interface']));
  }
  for (const link of model.links) {
    for (const side of ['a', 'b'] as const) use(link[side].deviceId, link[side].ifName, `link "${link.id}"`, [...link[side].path, 'endpoint']);
  }
  for (const [key, list] of users) {
    if (list.length < 2) continue;
    for (const entry of list) {
      const others = list.filter((o) => o !== entry).map((o) => o.what);
      report('ADDR_CONFLICT', `Interface ${key} is also used by ${others.join(' and ')}. Each WAN uplink, LAN and link needs its own interface`, entry.path);
    }
  }

  for (const link of model.links) {
    for (const side of ['a', 'b'] as const) {
      const end = link[side];
      const device = model.devices.get(end.deviceId);
      const path = [...end.path, 'endpoint'];
      if (!device) report('REF_UNKNOWN', `Unknown device "${end.deviceId}" in endpoint "${link.raw[side].endpoint}"`, path);
      else if (!device.interfaces.some((i) => i.name === end.ifName)) {
        report('REF_UNKNOWN', `Device "${device.id}" has no interface "${end.ifName}". List it under the device's \`interfaces\``, path);
      }
    }
  }

  for (const tunnel of model.tunnels) {
    for (const side of ['a', 'b'] as const) {
      const end = tunnel[side];
      const device = model.devices.get(end.deviceId);
      if (!device) report('REF_UNKNOWN', `Unknown device "${end.deviceId}"`, [...end.path, 'device']);
      else if (!device.interfaces.some((i) => i.name === end.underlay)) {
        report('REF_UNKNOWN', `Device "${device.id}" has no interface "${end.underlay}"`, [...end.path, 'underlay']);
      }
    }
  }

  const lockable = lockableObjects(model);
  for (const key of Object.keys(model.raw.locked_baseline ?? {})) {
    if (!lockable.has(key)) {
      report('REF_UNKNOWN', `locked_baseline entry "${key}" does not match any object id`, ['locked_baseline', key], 'warning');
    }
  }
}

function checkSubnets(model: ResolvedModel, report: Report): void {
  const networkAddress = (text: string | undefined, path: Path, what: string): void => {
    const cidr = text ? parseCidr(text) : null;
    if (cidr && !isNetworkAddress(cidr)) {
      report('NOT_NETWORK_ADDR', `${what} ${text} is not on a network boundary; the network address is ${formatSubnet(toSubnet(cidr))}`, path);
    }
  };

  networkAddress(model.raw.transit_pool, ['transit_pool'], 'transit_pool');
  for (const site of model.sites) {
    networkAddress(site.raw.supernet, [...site.path, 'supernet'], 'Supernet');
    for (const vlan of networksOf(site)) {
      const subnetPath = [...vlan.path, 'subnet'];
      networkAddress(vlan.raw.subnet, subnetPath, 'Subnet');
      if (!vlan.subnet || !vlan.info) continue;
      const text = formatSubnet(vlan.subnet.value);
      if (vlan.raw.hosts !== undefined && vlan.raw.hosts > vlan.info.usable) {
        report('TOO_SMALL', `${text} has ${vlan.info.usable} usable addresses but ${vlan.title} needs ${vlan.raw.hosts} hosts`, vlan.subnet.auto ? [...vlan.path, 'hosts'] : subnetPath);
      } else if (vlan.info.usable < 2) {
        report('TOO_SMALL', `${text} has no room for a gateway and a host; a ${vlan.kind === 'vlan' ? 'VLAN' : 'LAN'} needs at least a /30`, subnetPath);
      }
      if (!vlan.subnet.auto && site.supernet && !containsSubnet(site.supernet, vlan.subnet.value)) {
        report('OUTSIDE_SUPERNET', `${text} is not inside the supernet ${formatSubnet(site.supernet)} of site "${site.id}"`, subnetPath);
      }
    }
  }

  const pointToPoint = (text: string | undefined, subnet: Subnet | undefined, p2p: boolean, path: Path, what: string): void => {
    networkAddress(text, path, 'Subnet');
    if (!subnet || usableCount(subnet.prefix, { p2p }) >= 2) return;
    const hint = subnet.prefix === 31 ? ' A /31 is only allowed with `p2p: true`' : '';
    report('TOO_SMALL', `${formatSubnet(subnet)} does not have two usable addresses for ${what}.${hint}`, path);
  };
  for (const link of model.links) {
    pointToPoint(link.raw.subnet, link.subnet?.value, link.p2p, [...link.path, 'subnet'], `link "${link.id}"`);
  }
  for (const tunnel of model.tunnels) {
    pointToPoint(tunnel.raw.subnet, tunnel.subnet, tunnel.p2p, [...tunnel.path, 'subnet'], `tunnel "${tunnel.id}"`);
    for (const side of ['a', 'b'] as const) {
      const list = tunnel.raw.protected?.[side];
      if (Array.isArray(list)) {
        list.forEach((text, index) => networkAddress(text, [...tunnel.path, 'protected', side, index], 'Protected network'));
      }
    }
  }
}

interface SubnetEntity {
  subnet: Subnet;
  label: string;
  path: Path;
}

/**
 * Every subnet in the file. VLAN, link and tunnel subnets are one entity each.
 * Interfaces that are addressed directly (WAN uplinks, external routers) form
 * one shared segment per network, so two routers on the same /28 do not count
 * as an overlap.
 */
function collectSubnets(model: ResolvedModel): SubnetEntity[] {
  const declared: SubnetEntity[] = [];
  for (const site of model.sites) {
    for (const vlan of networksOf(site)) {
      if (!vlan.subnet) continue;
      declared.push({ subnet: vlan.subnet.value, label: vlan.label, path: vlan.subnet.auto ? vlan.path : [...vlan.path, 'subnet'] });
    }
  }
  for (const link of model.links) {
    if (link.subnet) declared.push({ subnet: link.subnet.value, label: `link "${link.id}"`, path: link.subnet.auto ? link.path : [...link.path, 'subnet'] });
  }
  for (const tunnel of model.tunnels) {
    if (tunnel.subnet) declared.push({ subnet: tunnel.subnet, label: `tunnel "${tunnel.id}"`, path: [...tunnel.path, 'subnet'] });
  }

  const segments = new Map<string, SubnetEntity>();
  for (const device of model.devices.values()) {
    for (const iface of device.interfaces) {
      // Membership of these is checked against the VLAN, LAN or link they belong to.
      if (!iface.address || iface.vlan !== undefined || iface.lan !== undefined || iface.linkId !== undefined) continue;
      const subnet = toSubnet(iface.address.value);
      if (declared.some((d) => sameSubnet(d.subnet, subnet))) continue;
      const key = formatSubnet(subnet);
      if (!segments.has(key)) segments.set(key, { subnet, label: `the network of ${device.id}:${iface.name}`, path: iface.addressPath });
    }
  }
  return [...declared, ...segments.values()];
}

function checkOverlap(model: ResolvedModel, report: Report): void {
  const entities = collectSubnets(model);
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (!overlaps(a.subnet, b.subnet)) continue;
      const describe = (x: SubnetEntity): string => `${formatSubnet(x.subnet)} (${x.label})`;
      report('OVERLAP', `${describe(a)} overlaps ${describe(b)}`, a.path);
      report('OVERLAP', `${describe(b)} overlaps ${describe(a)}`, b.path);
    }
  }
}

/** Reports an address that is outside `subnet`, or is its network/broadcast address. */
function checkHostAddress(report: Report, ip: Ip, subnet: Subnet, what: string, where: string, path: Path, p2p = false): boolean {
  if (!contains(subnet, ip)) {
    report('ADDR_NOT_IN_SUBNET', `${what} ${formatIp(ip)} is not inside ${formatSubnet(subnet)} (${where})`, path);
    return false;
  }
  if (!(p2p && subnet.prefix === 31) && isReservedAddress(subnet, ip)) {
    const which = ip === subnet.network ? 'network' : 'broadcast';
    report('ADDR_RESERVED', `${what} ${formatIp(ip)} is the ${which} address of ${formatSubnet(subnet)} and cannot be used by a host`, path);
    return false;
  }
  return true;
}

/** Reports a written prefix that differs from the subnet's (`10.10.1.1/24` in a /26). */
function checkPrefix(report: Report, text: string | undefined, subnet: Subnet, what: string, path: Path): void {
  const cidr = text?.includes('/') ? parseCidr(text) : null;
  if (cidr && cidr.prefix !== subnet.prefix) {
    report('ADDR_NOT_IN_SUBNET', `${what} ${text} has prefix /${cidr.prefix}, but its subnet ${formatSubnet(subnet)} is a /${subnet.prefix}`, path);
  }
}

function checkNetworkAddresses(model: ResolvedModel, report: Report): void {
  for (const site of model.sites) {
    const siteSubnets = [
      ...networksOf(site).flatMap((v) => (v.subnet ? [v.subnet.value] : [])),
      ...site.devices.flatMap((d) => d.interfaces.flatMap((i) => (i.address ? [toSubnet(i.address.value)] : []))),
    ];
    for (const vlan of networksOf(site)) {
      const subnet = vlan.subnet?.value;
      if (!subnet) continue;
      const where = vlan.label;

      if (vlan.gateway && !vlan.gateway.auto) {
        const path = [...vlan.path, 'gateway'];
        checkHostAddress(report, vlan.gateway.value, subnet, 'Gateway', where, path);
        checkPrefix(report, vlan.raw.gateway, subnet, 'Gateway', path);
      }
      for (const entry of vlan.statics) {
        checkHostAddress(report, entry.ip, subnet, `Static address of "${entry.name}"`, where, [...entry.path, 'ip']);
      }

      const dhcp = vlan.dhcp;
      const rawDhcp = vlan.raw.dhcp;
      if (!dhcp || !rawDhcp) continue;
      const dhcpPath = [...vlan.path, 'dhcp'];

      if (rawDhcp.pool) {
        if (!dhcp.pool) {
          report('ADDR_NOT_IN_SUBNET', `DHCP pool end ${rawDhcp.pool.end} is before its start ${rawDhcp.pool.start}`, [...dhcpPath, 'pool', 'end']);
        } else {
          checkHostAddress(report, dhcp.pool.value.start, subnet, 'DHCP pool start', where, [...dhcpPath, 'pool', 'start']);
          checkHostAddress(report, dhcp.pool.value.end, subnet, 'DHCP pool end', where, [...dhcpPath, 'pool', 'end']);
        }
      }
      (rawDhcp.exclude ?? []).forEach((text, index) => {
        const path = [...dhcpPath, 'exclude', index];
        const range = parseRange(text);
        if (!range) report('ADDR_NOT_IN_SUBNET', `Exclude range ${text} runs backwards`, path);
        else if (!contains(subnet, range.start) || !contains(subnet, range.end)) {
          report('ADDR_NOT_IN_SUBNET', `Exclude range ${text} is not inside ${formatSubnet(subnet)} (${where})`, path);
        }
      });

      if (dhcp.pool && !dhcp.pool.auto) {
        for (const entry of vlan.statics) {
          const excluded = dhcp.exclude.some((r) => rangeContains(r, entry.ip));
          if (rangeContains(dhcp.pool.value, entry.ip) && !excluded) {
            report('STATIC_IN_POOL', `Static address ${formatIp(entry.ip)} of "${entry.name}" is inside the DHCP pool ${formatIp(dhcp.pool.value.start)}–${formatIp(dhcp.pool.value.end)}. Move it or add it to \`exclude\``, [...entry.path, 'ip']);
          }
        }
      }

      if (dhcp.mode === 'server' && dhcp.server !== undefined) {
        checkHostAddress(report, dhcp.server, subnet, 'DHCP server', where, [...dhcpPath, 'server']);
      }
      if (dhcp.mode === 'relay') {
        if (dhcp.server === undefined) {
          report('DHCP_RELAY_UNREACHABLE', `${vlan.title} uses \`mode: relay\` but no \`server\` address is given`, [...dhcpPath, 'mode']);
        } else if (!siteSubnets.some((s) => contains(s, dhcp.server!))) {
          report('DHCP_RELAY_UNREACHABLE', `DHCP relay server ${formatIp(dhcp.server)} is not inside any subnet of site "${site.id}"`, [...dhcpPath, 'server']);
        }
      }
    }
  }
}

function checkInterfaceAddresses(model: ResolvedModel, report: Report): void {
  for (const device of model.devices.values()) {
    const site = siteOf(model, device);
    for (const iface of device.interfaces) {
      if (!iface.address) continue;
      const { ip, prefix } = iface.address.value;
      const own = toSubnet(iface.address.value);
      const text = formatCidr(iface.address.value);
      const name = `${device.id}:${iface.name}`;

      const vlan: RNetwork | undefined =
        iface.vlan !== undefined
          ? site?.vlans.find((v) => v.id === iface.vlan)
          : iface.lan !== undefined
            ? site?.lans.find((l) => l.id === iface.lan)
            : undefined;
      if (vlan?.subnet) {
        // The gateway itself was already checked on the VLAN or LAN. An address that comes from a
        // WAN or link means the interface is double-booked, which ADDR_CONFLICT already reports.
        const fromElsewhere = ['vlan-gateway', 'lan-gateway', 'wan', 'link'].includes(iface.addressSource ?? '');
        if (!fromElsewhere) {
          const ok = checkHostAddress(report, ip, vlan.subnet.value, `Address of ${name}`, vlan.label, iface.addressPath);
          if (ok && prefix !== vlan.subnet.value.prefix) {
            report('ADDR_NOT_IN_SUBNET', `Address ${text} of ${name} has prefix /${prefix}, but ${vlan.label} is ${formatSubnet(vlan.subnet.value)}`, iface.addressPath);
          }
        }
      } else if (iface.addressSource === 'interface' || iface.addressSource === 'wan' || iface.addressSource === 'subinterface') {
        if (isReservedAddress(own, ip)) {
          const which = ip === own.network ? 'network' : 'broadcast';
          report('ADDR_RESERVED', `Address ${text} of ${name} is the ${which} address of its subnet and cannot be used by a host`, iface.addressPath);
        }
      }
    }
  }

  for (const site of model.sites) {
    for (const wan of site.wans) {
      const rawIface = model.devices.get(wan.deviceId)?.raw.interfaces?.find((i) => i.name === wan.ifName);
      if (rawIface?.address && wan.raw.address && rawIface.address !== wan.raw.address) {
        report('ADDR_CONFLICT', `WAN address ${wan.raw.address} differs from the address ${rawIface.address} written on ${wan.deviceId}:${wan.ifName}`, [...wan.path, 'address']);
      }
      if (wan.gateway !== undefined && wan.subnet) {
        checkHostAddress(report, wan.gateway, wan.subnet, 'WAN gateway', `WAN of site "${site.id}"`, [...wan.path, 'gateway']);
      }
    }
    for (const lan of site.lans) {
      const rawIface = model.devices.get(lan.deviceId)?.raw.interfaces?.find((i) => i.name === lan.ifName);
      const own = rawIface?.address ? parseCidr(rawIface.address) : null;
      if (own && lan.gateway && !lan.gateway.auto && own.ip !== lan.gateway.value) {
        report('ADDR_CONFLICT', `LAN gateway ${formatIp(lan.gateway.value)} differs from the address ${rawIface!.address} written on ${lan.deviceId}:${lan.ifName}, which is the gateway. Remove one of them`, [...lan.path, 'gateway']);
      }
    }
  }

  for (const link of model.links) {
    const subnet = link.subnet?.value;
    for (const side of ['a', 'b'] as const) {
      const end = link[side];
      if (subnet && end.address && !end.address.auto) {
        const path = [...end.path, 'address'];
        checkHostAddress(report, end.address.value, subnet, `Address of side ${side}`, `link "${link.id}"`, path, link.p2p);
        checkPrefix(report, link.raw[side].address, subnet, `Address of side ${side}`, path);
      }
      const device = model.devices.get(end.deviceId);
      const rawIface = device?.raw.interfaces?.find((i) => i.name === end.ifName);
      const own = rawIface?.address ? parseCidr(rawIface.address) : null;
      if (own && subnet && end.address && (own.ip !== end.address.value || own.prefix !== subnet.prefix)) {
        report('ADDR_CONFLICT', `${end.deviceId}:${end.ifName} is written as ${rawIface!.address}, but link "${link.id}" gives it ${formatIp(end.address.value)}/${subnet.prefix}. Remove one of them`, [...end.path, 'endpoint']);
      }
    }
  }

  for (const tunnel of model.tunnels) {
    if (!tunnel.subnet) continue;
    for (const side of ['a', 'b'] as const) {
      const end = tunnel[side];
      if (!end.address || end.address.auto) continue;
      const path = [...end.path, 'address'];
      checkHostAddress(report, end.address.value, tunnel.subnet, `Tunnel address of side ${side}`, `tunnel "${tunnel.id}"`, path, tunnel.p2p);
      checkPrefix(report, tunnel.raw[side].address, tunnel.subnet, `Tunnel address of side ${side}`, path);
    }
  }
}

interface Assignment {
  ip: Ip;
  kind: 'interface' | 'static' | 'gateway' | 'tunnel';
  label: string;
  path: Path;
  /** Owning device (interfaces) for matching against a static's name. */
  device?: RDevice;
  staticName?: string;
}

function checkDuplicateAddresses(model: ResolvedModel, report: Report): void {
  const all: Assignment[] = [];
  for (const device of model.devices.values()) {
    for (const iface of device.interfaces) {
      if (iface.address) {
        all.push({ ip: iface.address.value.ip, kind: 'interface', label: `${device.id}:${iface.name}`, path: iface.addressPath, device });
      }
    }
  }
  for (const site of model.sites) {
    for (const vlan of networksOf(site)) {
      if (vlan.gateway) {
        all.push({ ip: vlan.gateway.value, kind: 'gateway', label: `the gateway of ${vlan.label}`, path: vlan.gateway.auto ? vlan.path : [...vlan.path, 'gateway'] });
      }
      for (const entry of vlan.statics) {
        all.push({ ip: entry.ip, kind: 'static', label: `static "${entry.name}"`, path: [...entry.path, 'ip'], staticName: entry.name });
      }
    }
  }
  for (const tunnel of model.tunnels) {
    for (const side of ['a', 'b'] as const) {
      const end = tunnel[side];
      if (end.address) {
        all.push({ ip: end.address.value, kind: 'tunnel', label: `side ${side} of tunnel "${tunnel.id}"`, path: end.address.auto ? end.path : [...end.path, 'address'] });
      }
    }
  }

  const byIp = new Map<Ip, Assignment[]>();
  for (const a of all) byIp.set(a.ip, [...(byIp.get(a.ip) ?? []), a]);
  for (const [ip, group] of byIp) {
    if (group.length < 2) continue;
    const interfaces = group.filter((a) => a.kind === 'interface');
    const sameDevice = (name: string): boolean =>
      interfaces.some((i) => [i.device!.id, i.device!.name].some((n) => n.toLowerCase() === name.toLowerCase()));
    const claims = group.filter((a) => {
      // A gateway is "owned" by whatever else holds its address (normally a router interface).
      if (a.kind === 'gateway') return group.every((o) => o.kind === 'gateway');
      // A static that documents an interface of the device it is named after is the same assignment.
      if (a.kind === 'static') return !sameDevice(a.staticName!);
      return true;
    });
    if (claims.length < 2) continue;
    for (const claim of claims) {
      const others = claims.filter((o) => o !== claim).map((o) => o.label);
      report('ADDR_DUP', `${formatIp(ip)} is assigned more than once: here and to ${others.join(', ')}`, claim.path);
    }
  }
}


function checkTrunks(model: ResolvedModel, report: Report): void {
  for (const site of model.sites) {
    const vlanIds = new Set(site.vlans.map((v) => v.id));
    for (const device of site.devices) {
      for (const port of device.ports) {
        (port.raw.allowed ?? []).forEach((id, index) => {
          if (!vlanIds.has(id)) {
            report('TRUNK_VLAN_MISSING', `Trunk ${device.id}:${port.raw.range} allows VLAN ${id}, which site "${site.id}" does not define`, [...port.path, 'allowed', index]);
          }
        });
      }
    }

    // VLANs that reach a routing device over some cable in this site.
    const routed = new Set<number>();
    const carriedBy = (deviceId: string, ifName: string | undefined): number[] => {
      const device = model.devices.get(deviceId);
      if (!device || device.siteId !== site.id || !ifName) return [];
      const ref = lookupRef(model, `${deviceId}:${ifName}`);
      if (ref?.port) {
        if (ref.port.mode === 'trunk') return ref.port.allowed?.value ?? [];
        return ref.port.vlan === undefined ? [] : [ref.port.vlan];
      }
      return [];
    };
    for (const connection of model.connections) {
      const ends = [connection.a, connection.b];
      ends.forEach((end, index) => {
        const other = ends[1 - index];
        const otherDevice = model.devices.get(other.deviceId);
        if (!otherDevice || !ROUTING_TYPES.has(otherDevice.type) || other.deviceId === end.deviceId) return;
        for (const id of carriedBy(end.deviceId, end.ifName)) routed.add(id);
      });
    }

    const hasRouter = site.devices.some((d) => ROUTING_TYPES.has(d.type));
    if (!hasRouter) continue;
    for (const device of site.devices) {
      const svi = (id: number): boolean => device.interfaces.some((i: RInterface) => i.vlan === id && i.address !== undefined);
      for (const port of device.ports) {
        if (port.mode !== 'access' || port.vlan === undefined || !vlanIds.has(port.vlan)) continue;
        if (routed.has(port.vlan) || svi(port.vlan)) continue;
        report('TRUNK_VLAN_MISSING', `VLAN ${port.vlan} has access ports on ${device.id} but is not carried on any trunk to a router, so its hosts cannot reach their gateway`, [...port.path, 'vlan']);
      }
    }
  }
}

/** Unmanaged devices: the network they say they are in must match what they are cabled to. */
function checkDeviceNetworks(model: ResolvedModel, report: Report): void {
  const describe = (site: RSite | undefined, n: EndNetwork): string => {
    if (n === undefined) return 'no network';
    if ('vlan' in n) return `VLAN ${n.vlan}`;
    if ('lan' in n) return `LAN "${site?.lans.find((l) => l.id === n.lan)?.name ?? n.lan}"`;
    return 'a trunk';
  };
  const refText = (end: { deviceId: string; ifName?: string }): string => (end.ifName ? `${end.deviceId}:${end.ifName}` : end.deviceId);

  for (const device of model.devices.values()) {
    const site = siteOf(model, device);
    if (!site) continue;
    const field = device.raw.vlan !== undefined ? 'vlan' : device.raw.lan !== undefined ? 'lan' : undefined;
    if (field && (device.ports.length || ROUTING_TYPES.has(device.type))) {
      const why = device.ports.length ? 'its ports set their own VLANs' : `a ${device.type} routes between networks`;
      report('NETWORK_MISMATCH', `\`${field}\` on a device is for unmanaged devices, but ${why}. Remove it`, [...device.path, field]);
      continue;
    }

    const own: EndNetwork = device.vlan ? { vlan: device.vlan.value } : device.lan ? { lan: device.lan.value } : undefined;
    const peers = deviceLevelPeers(model, device.id);
    const path = field ? [...device.path, field] : device.raw.uplink ? [...device.path, 'uplink'] : device.path;

    if (!own) {
      // Only devices that could have been inferred and were not: cabled to several networks.
      if (device.ports.length || device.interfaces.length || ROUTING_TYPES.has(device.type)) continue;
      const seen = new Map<string, string>();
      for (const peer of peers) {
        const n = networkAt(model, peer);
        const key = endNetworkKey(n);
        if (key && key !== 'trunk') seen.set(key, `${describe(site, n)} (${refText(peer)})`);
      }
      if (seen.size > 1) {
        report('NETWORK_MISMATCH', `Device "${device.id}" is cabled into more than one network: ${[...seen.values()].join(', ')}. An unmanaged device passes everything through, so these would be one broadcast domain`, path);
      }
    }

    for (const peer of peers) {
      const n = networkAt(model, peer);
      const peerDevice = model.devices.get(peer.deviceId);
      if (n && 'trunk' in n) {
        report('NETWORK_MISMATCH', `Device "${device.id}" is cabled to trunk port ${refText(peer)}. An unmanaged device needs an access port in one VLAN`, path);
      } else if (own && n && endNetworkKey(n) !== endNetworkKey(own)) {
        report('NETWORK_MISMATCH', `Device "${device.id}" is in ${describe(site, own)}, but it is cabled to ${refText(peer)}, which is in ${describe(site, n)}`, path);
      } else if (own && !n && peer.ifName && peerDevice && ROUTING_TYPES.has(peerDevice.type)) {
        const hint = 'vlan' in own ? '. A VLAN reaches a router over a trunk; for a network straight on a router port, use a LAN' : '';
        report('NETWORK_MISMATCH', `Device "${device.id}" is in ${describe(site, own)}, but it is cabled to router port ${refText(peer)}, which is in no VLAN or LAN${hint}`, path);
      }
    }
  }
}

function checkTunnels(model: ResolvedModel, report: Report): void {
  for (const tunnel of model.tunnels) {
    const needsSubnet = tunnel.type !== 'ipsec-policy';
    if (needsSubnet && !tunnel.raw.subnet) {
      report('TUNNEL_SUBNET', `Tunnel "${tunnel.id}" of type ${tunnel.type} needs a \`subnet\` for its tunnel interfaces`, [...tunnel.path, 'type']);
    } else if (!needsSubnet && tunnel.raw.subnet) {
      report('TUNNEL_SUBNET', `Policy-based IPsec has no tunnel interface, so \`subnet\` is not allowed on tunnel "${tunnel.id}"`, [...tunnel.path, 'subnet']);
    }

    for (const side of ['a', 'b'] as const) {
      const end = tunnel[side];
      const device = model.devices.get(end.deviceId);
      const iface = device?.interfaces.find((i) => i.name === end.underlay);
      if (!device || !iface) continue; // REF_UNKNOWN already reported
      const path = [...end.path, 'underlay'];
      if (end.peerIp === undefined) {
        report('TUNNEL_PEER', `Underlay interface ${device.id}:${iface.name} has no address, so the other side has nothing to peer with`, path);
        continue;
      }
      const site = siteOf(model, device);
      const isWan = site?.wans.some((w) => w.deviceId === device.id && w.ifName === iface.name) ?? false;
      if (!isWan && iface.role !== 'wan' && iface.linkId === undefined) {
        report('TUNNEL_PEER', `Underlay interface ${device.id}:${iface.name} is neither a WAN interface nor the end of a link; tunnels should be sourced from a public/WAN address`, path, 'warning');
      }
    }
    if (tunnel.a.peerIp !== undefined && tunnel.a.peerIp === tunnel.b.peerIp) {
      report('TUNNEL_PEER', `Both ends of tunnel "${tunnel.id}" have the same peer address ${formatIp(tunnel.a.peerIp)}`, [...tunnel.b.path, 'underlay']);
    }

    const clashes: string[] = [];
    for (const a of tunnel.a.protected.value) {
      for (const b of tunnel.b.protected.value) {
        if (overlaps(a, b)) clashes.push(`${formatSubnet(a)} (side a) and ${formatSubnet(b)} (side b)`);
      }
    }
    if (clashes.length) {
      const path = tunnel.raw.protected ? [...tunnel.path, 'protected'] : tunnel.path;
      report('TUNNEL_PROTECTED_OVERLAP', `Protected networks of tunnel "${tunnel.id}" overlap: ${clashes.join('; ')}. Traffic for these addresses cannot be routed through the tunnel`, path);
    }
  }
}

interface Lockable {
  raw: object;
  path: Path;
  locked: boolean;
}

/** Everything that can carry `locked: true`, by its `locked_baseline` key. */
function lockableObjects(model: ResolvedModel): Map<string, Lockable> {
  const map = new Map<string, Lockable>();
  const add = (key: string, item: Lockable): void => {
    if (!map.has(key)) map.set(key, item);
  };
  for (const group of model.external) {
    add(group.id, group);
    for (const device of group.devices) add(device.id, device);
  }
  for (const site of model.sites) {
    add(site.id, site);
    for (const device of site.devices) add(device.id, device);
    for (const vlan of site.vlans) add(`${site.id}:${vlan.id}`, vlan);
    for (const lan of site.lans) add(lan.id, lan);
  }
  for (const link of model.links) add(link.id, link);
  for (const tunnel of model.tunnels) add(tunnel.id, tunnel);
  return map;
}

interface Difference {
  path: Path;
  expected: unknown;
  actual: unknown;
}

/** Deep comparison that ignores `locked` flags and reports each differing leaf. */
function diff(expected: unknown, actual: unknown, path: Path, out: Difference[]): void {
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let i = 0; i < length; i++) diff(expected[i], actual[i], [...path, i], out);
  } else if (isObject(expected) && isObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    keys.delete('locked');
    for (const key of keys) diff(expected[key], actual[key], [...path, key], out);
  } else if (expected !== actual) {
    out.push({ path, expected, actual });
  }
}

function checkLocked(model: ResolvedModel, report: Report): void {
  const baseline = model.raw.locked_baseline;
  if (!baseline) return;
  const show = (value: unknown): string => (value === undefined ? 'nothing' : JSON.stringify(value));
  for (const [key, item] of lockableObjects(model)) {
    if (!item.locked || !(key in baseline)) continue;
    const differences: Difference[] = [];
    diff(baseline[key], item.raw, [], differences);
    for (const d of differences.slice(0, 10)) {
      const field = d.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '');
      report('LOCKED_CHANGED', `Locked object "${key}" was changed: \`${field}\` is ${show(d.actual)}, but the baseline says ${show(d.expected)}`, [...item.path, ...d.path]);
    }
  }
}
