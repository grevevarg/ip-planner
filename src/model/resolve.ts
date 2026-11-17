/**
 * Raw (schema-valid) document → resolved model.
 *
 * Fills in everything the user is allowed to leave out: auto-allocated subnets,
 * gateways, DHCP pools, link and tunnel addresses, sub-interfaces. Each derived
 * value is wrapped in `Val` with `auto: true` so the views can badge it.
 *
 * The resolver is forgiving: values it cannot make sense of are left undefined
 * and the checks in validate.ts explain why. It reports only what it alone can
 * know (allocation failures).
 */
import {
  allocateVlsm,
  parseCidr,
  parseIp,
  parseRange,
  prefixForHosts,
  rangeSize,
  subnetInfo,
  subtractRanges,
  toSubnet,
  type AllocRequest,
  type Cidr,
  type Ip,
  type IpRange,
  type Subnet,
  type SubnetInfo,
} from '../ip';
import type { Path, Report } from './diagnostics';
import { parsePortRange, rangeCoversPort, type PortRange } from './ports';
import type {
  Crypto,
  Device,
  Diagram,
  ExternalGroup,
  Interface,
  Lan,
  Link,
  Meta,
  Netplan,
  Port,
  Site,
  Tunnel,
  Vlan,
  Wan,
} from './types';

/** A value plus whether the app computed it (`auto`) or the file stated it. */
export interface Val<T> {
  value: T;
  auto: boolean;
}

const given = <T>(value: T): Val<T> => ({ value, auto: false });
const derived = <T>(value: T): Val<T> => ({ value, auto: true });

export interface RStatic {
  name: string;
  ip: Ip;
  role?: string;
  path: Path;
}

export interface RDhcp {
  mode: 'server' | 'relay' | 'none';
  /** Device id that runs the pool (mode server). */
  on?: string;
  server?: Ip;
  /** First–last address of the pool as written or defaulted. */
  pool?: Val<IpRange>;
  /** Excluded ranges as written. */
  exclude: IpRange[];
  /** What is actually handed out: the pool minus excludes (and minus statics and the gateway for an auto pool). */
  effective: IpRange[];
  /** Number of addresses in `effective`. */
  size: number;
}

/** What VLANs and LANs have in common: a subnet with a gateway, DHCP and statics. */
export interface RNet {
  raw: Vlan | Lan;
  path: Path;
  siteId: string;
  name: string;
  /** Short name for messages: `VLAN 10` or `LAN "it"`. */
  title: string;
  /** `title` plus the site: `VLAN 10 of braintech`. */
  label: string;
  /** `hosts` plus growth headroom; what an auto-allocated subnet is sized for. */
  hostsNeeded?: number;
  subnet?: Val<Subnet>;
  info?: SubnetInfo;
  gateway?: Val<Ip>;
  dhcp?: RDhcp;
  statics: RStatic[];
  locked: boolean;
}

export interface RVlan extends RNet {
  kind: 'vlan';
  raw: Vlan;
  id: number;
  native: boolean;
}

/** An untagged network on one router interface. */
export interface RLan extends RNet {
  kind: 'lan';
  raw: Lan;
  id: string;
  /** The device and interface the LAN is attached to; the interface holds the gateway. */
  deviceId: string;
  ifName: string;
}

/** A VLAN or a LAN. */
export type RNetwork = RVlan | RLan;

/** Where an interface's address came from. */
export type AddressSource = 'interface' | 'wan' | 'link' | 'vlan-gateway' | 'lan-gateway' | 'subinterface';

export interface RInterface {
  deviceId: string;
  name: string;
  /** Path of the interface (or of the parent interface for an auto sub-interface). */
  path: Path;
  /** Path of the value the address was read from, for diagnostics. */
  addressPath: Path;
  address?: Val<Cidr>;
  addressSource?: AddressSource;
  role?: string;
  /** VLAN the interface sits in (SVI, host NIC or sub-interface). */
  vlan?: number;
  /** LAN the interface sits in: the LAN's own gateway interface, or a host NIC that says `lan:`. */
  lan?: string;
  /** Name of the parent interface when this is a sub-interface. */
  parent?: string;
  /** Raw `link` target. */
  link?: string;
  /** Id of the `links` entry this interface is an endpoint of. */
  linkId?: string;
  description?: string;
  hasSubinterfaces: boolean;
}

export interface RPort {
  deviceId: string;
  raw: Port;
  path: Path;
  range: PortRange | null;
  mode: 'access' | 'trunk';
  vlan?: number;
  /** Allowed VLANs on a trunk; `auto` when defaulted to all VLANs of the site. */
  allowed?: Val<number[]>;
  link?: string;
}

export interface RDevice {
  raw: Device;
  path: Path;
  id: string;
  name: string;
  type: Device['type'];
  /** Icon reference: built-in name, repo-relative path or https URL. */
  icon: string;
  siteId?: string;
  groupId?: string;
  locked: boolean;
  /** Interfaces in file order, each followed by its sub-interfaces. */
  interfaces: RInterface[];
  ports: RPort[];
  /** Network all ports are in, for a device not configured per port (an unmanaged switch). Auto when inferred from the cabling. */
  vlan?: Val<number>;
  lan?: Val<string>;
  /** Raw `uplink` target. */
  uplink?: string;
}

/** Device types that route between networks, so they are never "in" one network. */
export const ROUTING_TYPES = new Set(['router', 'l3switch', 'firewall']);

export interface RWan {
  raw: Wan;
  path: Path;
  name?: string;
  deviceId: string;
  ifName: string;
  address?: Cidr;
  subnet?: Subnet;
  gateway?: Ip;
  nat: boolean;
}

export interface RSite {
  raw: Site;
  path: Path;
  id: string;
  name: string;
  supernet?: Subnet;
  color?: string;
  /** Uplinks in file order; `wan` may be written as one object or as a list. */
  wans: RWan[];
  vlans: RVlan[];
  lans: RLan[];
  devices: RDevice[];
  locked: boolean;
}

export interface RExternal {
  raw: ExternalGroup;
  path: Path;
  id: string;
  name: string;
  locked: boolean;
  devices: RDevice[];
}

export interface RLinkEnd {
  path: Path;
  deviceId: string;
  ifName: string;
  address?: Val<Ip>;
}

export interface RLink {
  raw: Link;
  path: Path;
  id: string;
  name: string;
  subnet?: Val<Subnet>;
  info?: SubnetInfo;
  p2p: boolean;
  a: RLinkEnd;
  b: RLinkEnd;
  locked: boolean;
}

export interface RTunnelEnd {
  path: Path;
  deviceId: string;
  underlay: string;
  /** Site of the device, if it belongs to one. */
  siteId?: string;
  /** Address of the underlay interface: what the other side peers with. */
  peerIp?: Ip;
  /** Address of the tunnel interface. */
  address?: Val<Ip>;
  protected: Val<Subnet[]>;
}

export interface RTunnel {
  raw: Tunnel;
  path: Path;
  id: string;
  name: string;
  type: Tunnel['type'];
  subnet?: Subnet;
  info?: SubnetInfo;
  p2p: boolean;
  a: RTunnelEnd;
  b: RTunnelEnd;
  routing: Val<NonNullable<Tunnel['routing']>>;
  crypto?: Crypto;
  locked: boolean;
}

export interface REndpoint {
  deviceId: string;
  ifName?: string;
  ip?: Ip;
}

/** A physical connection drawn as a solid line in the topology. */
export interface RConnection {
  kind: 'cable' | 'wan' | 'link';
  a: REndpoint;
  b: REndpoint;
  /** Display name (links and named WAN uplinks). */
  name?: string;
  subnet?: Subnet;
  /** VLANs carried when one end is a trunk port. */
  trunkVlans?: number[];
}

export interface ResolvedModel {
  raw: Netplan;
  meta: Meta;
  diagram: Diagram;
  transitPool?: Subnet;
  sites: RSite[];
  external: RExternal[];
  links: RLink[];
  tunnels: RTunnel[];
  /** Every device of every site and external group, by id (first one wins on duplicates). */
  devices: Map<string, RDevice>;
  connections: RConnection[];
}

/** What a `device:interface` reference points at. */
export interface ResolvedRef {
  device: RDevice;
  ifName?: string;
  iface?: RInterface;
  port?: RPort;
}

/** Splits `device:interface` at the first colon. */
export function splitRef(ref: string): { deviceId: string; ifName?: string } {
  const colon = ref.indexOf(':');
  return colon < 0 ? { deviceId: ref } : { deviceId: ref.slice(0, colon), ifName: ref.slice(colon + 1) };
}

/**
 * Looks up a reference. Returns null when the device is unknown, and a result
 * without `iface`/`port` when the device exists but the interface does not.
 */
export function lookupRef(model: Pick<ResolvedModel, 'devices'>, ref: string): ResolvedRef | null {
  const { deviceId, ifName } = splitRef(ref);
  const device = model.devices.get(deviceId);
  if (!device) return null;
  if (ifName === undefined) return { device };
  const iface = device.interfaces.find((i) => i.name === ifName);
  if (iface) return { device, ifName, iface };
  const port = device.ports.find((p) => p.range && rangeCoversPort(p.range, ifName));
  return { device, ifName, port };
}

const cidrOf = (text: string | undefined): Cidr | undefined => (text ? (parseCidr(text) ?? undefined) : undefined);
const ipOf = (text: string | undefined): Ip | undefined => (text ? (parseIp(text) ?? undefined) : undefined);

/** Parses `a.b.c.d` or `a.b.c.d/n`, dropping the prefix. */
function hostOf(text: string | undefined): Ip | undefined {
  if (!text) return undefined;
  const slash = text.indexOf('/');
  return ipOf(slash < 0 ? text : text.slice(0, slash));
}

function resolveDevice(raw: Device, path: Path, owner: { siteId?: string; groupId?: string }): RDevice {
  const interfaces: RInterface[] = (raw.interfaces ?? []).map((iface: Interface, index) => {
    const ifPath = [...path, 'interfaces', index];
    const address = cidrOf(iface.address);
    return {
      deviceId: raw.id,
      name: iface.name,
      path: ifPath,
      addressPath: [...ifPath, 'address'],
      address: address ? given(address) : undefined,
      addressSource: address ? 'interface' : undefined,
      role: iface.role,
      vlan: iface.vlan,
      lan: iface.lan,
      link: iface.link,
      description: iface.description,
      hasSubinterfaces: iface.subinterfaces !== undefined,
    };
  });
  const ports: RPort[] = (raw.ports ?? []).map((port: Port, index) => ({
    deviceId: raw.id,
    raw: port,
    path: [...path, 'ports', index],
    range: parsePortRange(port.range),
    mode: port.mode,
    vlan: port.vlan,
    link: port.link,
  }));
  return {
    raw,
    path,
    id: raw.id,
    name: raw.name ?? raw.id,
    type: raw.type,
    icon: raw.icon ?? raw.type,
    ...owner,
    locked: raw.locked ?? false,
    interfaces,
    ports,
    vlan: raw.vlan === undefined ? undefined : given(raw.vlan),
    lan: raw.lan === undefined ? undefined : given(raw.lan),
    uplink: raw.uplink,
  };
}

function resolveDhcp(net: RNet): RDhcp | undefined {
  const raw = net.raw.dhcp;
  if (!raw) return undefined;
  const exclude = (raw.exclude ?? []).map((e) => parseRange(e)).filter((r): r is IpRange => r !== null);
  const dhcp: RDhcp = { mode: raw.mode, on: raw.on, server: ipOf(raw.server), exclude, effective: [], size: 0 };
  if (raw.mode === 'none') return dhcp;

  const info = net.info;
  const gateway = net.gateway?.value;
  if (raw.pool) {
    const start = ipOf(raw.pool.start);
    const end = ipOf(raw.pool.end);
    if (start !== undefined && end !== undefined && start <= end) dhcp.pool = given({ start, end });
  } else if (info && info.firstUsable !== null && info.lastUsable !== null && gateway !== undefined) {
    // Default: the address after the gateway up to the last usable address. If the
    // gateway is itself the last usable address, use everything below it instead.
    const range =
      gateway < info.lastUsable
        ? { start: Math.max(gateway + 1, info.firstUsable), end: info.lastUsable }
        : { start: info.firstUsable, end: gateway - 1 };
    if (range.start <= range.end) dhcp.pool = derived(range);
  }
  if (dhcp.pool) {
    const holes = [...exclude];
    // Explicit pools must not contain statics (STATIC_IN_POOL); auto pools step around them.
    if (dhcp.pool.auto) holes.push(...net.statics.map((s) => ({ start: s.ip, end: s.ip })));
    if (gateway !== undefined) holes.push({ start: gateway, end: gateway });
    dhcp.effective = subtractRanges(dhcp.pool.value, holes);
    dhcp.size = dhcp.effective.reduce((sum, r) => sum + rangeSize(r), 0);
  }
  return dhcp;
}

export function resolve(raw: Netplan, report: Report): ResolvedModel {
  const devices = new Map<string, RDevice>();
  const register = (device: RDevice): RDevice => {
    if (!devices.has(device.id)) devices.set(device.id, device);
    return device;
  };

  // ── Devices, sites and explicitly written subnets ────────────────────────
  const external: RExternal[] = (raw.external ?? []).map((group, gi) => {
    const path: Path = ['external', gi];
    return {
      raw: group,
      path,
      id: group.id,
      name: group.name ?? group.id,
      locked: group.locked ?? false,
      devices: (group.devices ?? []).map((d, di) =>
        register(resolveDevice(d, [...path, 'devices', di], { groupId: group.id })),
      ),
    };
  });

  /** The fields VLANs and LANs share, read straight from the file. */
  const netBase = (net: Vlan | Lan, path: Path, siteId: string) => {
    const cidr = cidrOf(net.subnet);
    return {
      path,
      siteId,
      hostsNeeded: net.hosts === undefined ? undefined : Math.ceil(net.hosts * (1 + (net.growth_percent ?? 0) / 100)),
      subnet: cidr ? given(toSubnet(cidr)) : undefined,
      statics: (net.static ?? []).flatMap((entry, ei): RStatic[] => {
        const ip = ipOf(entry.ip);
        return ip === undefined ? [] : [{ name: entry.name, ip, role: entry.role, path: [...path, 'static', ei] }];
      }),
      locked: net.locked ?? false,
    };
  };

  const sites: RSite[] = (raw.sites ?? []).map((site, si) => {
    const path: Path = ['sites', si];
    const supernetCidr = cidrOf(site.supernet);
    const vlans: RVlan[] = (site.vlans ?? []).map((vlan, vi) => ({
      ...netBase(vlan, [...path, 'vlans', vi], site.id),
      kind: 'vlan',
      raw: vlan,
      id: vlan.id,
      name: vlan.name ?? `VLAN ${vlan.id}`,
      title: `VLAN ${vlan.id}`,
      label: `VLAN ${vlan.id} of ${site.id}`,
      native: vlan.native ?? false,
    }));
    const lans: RLan[] = (site.lans ?? []).map((lan, li) => ({
      ...netBase(lan, [...path, 'lans', li], site.id),
      kind: 'lan',
      raw: lan,
      id: lan.id,
      name: lan.name ?? lan.id,
      title: `LAN "${lan.id}"`,
      label: `LAN "${lan.id}" of ${site.id}`,
      deviceId: lan.device,
      ifName: lan.interface,
    }));
    const rawWans = site.wan === undefined ? [] : Array.isArray(site.wan) ? site.wan : [site.wan];
    const wans: RWan[] = rawWans.map((wan, wi) => {
      const address = cidrOf(wan.address);
      return {
        raw: wan,
        path: Array.isArray(site.wan) ? [...path, 'wan', wi] : [...path, 'wan'],
        name: wan.name,
        deviceId: wan.device,
        ifName: wan.interface,
        address,
        subnet: address ? toSubnet(address) : undefined,
        gateway: ipOf(wan.gateway),
        nat: wan.nat ?? false,
      };
    });
    return {
      raw: site,
      path,
      id: site.id,
      name: site.name ?? site.id,
      supernet: supernetCidr ? toSubnet(supernetCidr) : undefined,
      color: site.color,
      wans,
      vlans,
      lans,
      devices: (site.devices ?? []).map((d, di) =>
        register(resolveDevice(d, [...path, 'devices', di], { siteId: site.id })),
      ),
      locked: site.locked ?? false,
    };
  });
  const siteById = new Map(sites.map((s) => [s.id, s] as const));
  const findInterface = (deviceId: string, ifName: string): RInterface | undefined =>
    devices.get(deviceId)?.interfaces.find((i) => i.name === ifName);

  // A LAN whose interface already has an address takes its subnet (and, below,
  // its gateway) from there, so the plan matches what is configured.
  for (const site of sites) {
    for (const lan of site.lans) {
      const own = findInterface(lan.deviceId, lan.ifName)?.address?.value;
      if (own && !lan.subnet) lan.subnet = given(toSubnet(own));
    }
  }

  const links: RLink[] = (raw.links ?? []).map((link, li) => {
    const path: Path = ['links', li];
    const cidr = cidrOf(link.subnet);
    const end = (side: 'a' | 'b'): RLinkEnd => {
      const ref = splitRef(link[side].endpoint);
      const ip = hostOf(link[side].address);
      return {
        path: [...path, side],
        deviceId: ref.deviceId,
        ifName: ref.ifName ?? '',
        address: ip === undefined ? undefined : given(ip),
      };
    };
    return {
      raw: link,
      path,
      id: link.id,
      name: link.name ?? link.id,
      subnet: cidr ? given(toSubnet(cidr)) : undefined,
      p2p: link.p2p ?? false,
      a: end('a'),
      b: end('b'),
      locked: link.locked ?? false,
    };
  });

  const tunnelSubnets = (raw.tunnels ?? []).map((t) => cidrOf(t.subnet)).map((c) => (c ? toSubnet(c) : undefined));

  // ── Auto-allocation ──────────────────────────────────────────────────────
  // Everything already written down is reserved, so auto subnets never collide
  // with it: VLAN, link and tunnel subnets plus the networks of addressed interfaces.
  const reserved: Subnet[] = [];
  for (const site of sites) {
    for (const net of [...site.vlans, ...site.lans]) if (net.subnet) reserved.push(net.subnet.value);
    for (const wan of site.wans) if (wan.subnet) reserved.push(wan.subnet);
  }
  for (const link of links) if (link.subnet) reserved.push(link.subnet.value);
  for (const subnet of tunnelSubnets) if (subnet) reserved.push(subnet);
  for (const device of devices.values()) {
    for (const iface of device.interfaces) if (iface.address) reserved.push(toSubnet(iface.address.value));
  }

  for (const site of sites) {
    // VLANs and LANs share the supernet. Same-sized requests go in VLAN id
    // order, then LANs in file order (VLAN ids stop at 4094).
    const nets: RNetwork[] = [...site.vlans, ...site.lans];
    const requests: AllocRequest[] = [];
    nets.forEach((net, index) => {
      if (net.subnet) return;
      if (net.hostsNeeded === undefined) {
        report('ALLOC_FAILED', `${net.title} has neither \`subnet\` nor \`hosts\`, so no subnet can be allocated`, net.path);
        return;
      }
      const prefix = prefixForHosts(net.hostsNeeded);
      if (prefix === null || !site.supernet || prefix < site.supernet.prefix) {
        report(
          'ALLOC_FAILED',
          `${net.title} needs ${net.hostsNeeded} hosts, which does not fit in the site supernet ${site.raw.supernet}`,
          [...net.path, 'hosts'],
        );
        return;
      }
      const order = net.kind === 'vlan' ? net.id : 5000 + index;
      requests.push({ key: String(index), prefix, order });
    });
    if (!site.supernet || requests.length === 0) continue;
    const { allocated, failed } = allocateVlsm(site.supernet, reserved, requests);
    for (const [key, subnet] of allocated) {
      nets[Number(key)].subnet = derived(subnet);
      reserved.push(subnet);
    }
    for (const key of failed) {
      const net = nets[Number(key)];
      report(
        'ALLOC_FAILED',
        `No free /${prefixForHosts(net.hostsNeeded!)} left in ${site.raw.supernet} for ${net.title} (${net.hostsNeeded} hosts)`,
        [...net.path, 'hosts'],
      );
    }
  }

  const transitCidr = cidrOf(raw.transit_pool);
  const transitPool = transitCidr ? toSubnet(transitCidr) : undefined;
  const linkRequests: AllocRequest[] = [];
  for (const link of links) {
    if (link.subnet) continue;
    if (!transitPool) {
      report('ALLOC_FAILED', `Link "${link.id}" has no \`subnet\` and there is no top-level \`transit_pool\` to allocate one from`, link.path);
      continue;
    }
    linkRequests.push({ key: link.id, prefix: link.p2p ? 31 : 30, order: 0 });
  }
  if (transitPool && linkRequests.length) {
    const { allocated, failed } = allocateVlsm(transitPool, reserved, linkRequests);
    for (const link of links) {
      const subnet = link.subnet ? undefined : allocated.get(link.id);
      if (subnet) {
        link.subnet = derived(subnet);
        reserved.push(subnet);
      } else if (failed.includes(link.id) && !link.subnet) {
        report('ALLOC_FAILED', `No free subnet left in transit_pool ${raw.transit_pool} for link "${link.id}"`, link.path);
      }
    }
  }

  // ── Derived VLAN and LAN values ──────────────────────────────────────────
  for (const site of sites) {
    for (const net of [...site.vlans, ...site.lans]) {
      if (net.subnet) net.info = subnetInfo(net.subnet.value);
      const gateway = hostOf(net.raw.gateway);
      // A LAN's gateway is its router interface, so an address written there counts as given.
      const ifaceAddress = net.kind === 'lan' ? findInterface(net.deviceId, net.ifName)?.address : undefined;
      if (gateway !== undefined) net.gateway = given(gateway);
      else if (ifaceAddress && !ifaceAddress.auto) net.gateway = given(ifaceAddress.value.ip);
      else if (net.info && net.info.firstUsable !== null) net.gateway = derived(net.info.firstUsable);
      net.dhcp = resolveDhcp(net);
    }
  }

  // ── Interface addresses that come from elsewhere ─────────────────────────
  for (const site of sites) {
    for (const wan of site.wans) {
      const iface = findInterface(wan.deviceId, wan.ifName);
      if (!iface) continue;
      if (wan.address && !iface.address) {
        iface.address = given(wan.address);
        iface.addressSource = 'wan';
        iface.addressPath = [...wan.path, 'address'];
      } else if (!wan.address && iface.address) {
        // The address was written on the interface instead of under `wan`.
        wan.address = iface.address.value;
        wan.subnet = toSubnet(iface.address.value);
      }
      iface.role ??= 'wan';
    }
    for (const lan of site.lans) {
      const iface = findInterface(lan.deviceId, lan.ifName);
      if (!iface) continue;
      iface.lan ??= lan.id;
      iface.role ??= 'lan';
      if (!iface.address && lan.gateway && lan.subnet) {
        iface.address = {
          value: { ip: lan.gateway.value, prefix: lan.subnet.value.prefix },
          auto: lan.gateway.auto || lan.subnet.auto,
        };
        iface.addressSource = 'lan-gateway';
        iface.addressPath = lan.gateway.auto ? lan.path : [...lan.path, 'gateway'];
      }
    }
  }

  for (const link of links) {
    if (link.subnet) link.info = subnetInfo(link.subnet.value, { p2p: link.p2p });
    const info = link.info;
    (['a', 'b'] as const).forEach((side, index) => {
      const end = link[side];
      if (!end.address && info && info.firstUsable !== null && info.usable >= 2) {
        end.address = derived(info.firstUsable + index);
      }
      const iface = findInterface(end.deviceId, end.ifName);
      if (!iface) return;
      iface.linkId = link.id;
      iface.role ??= 'p2p';
      if (end.address && link.subnet && !iface.address) {
        iface.address = { value: { ip: end.address.value, prefix: link.subnet.value.prefix }, auto: end.address.auto };
        iface.addressSource = 'link';
        iface.addressPath = end.address.auto ? end.path : [...end.path, 'address'];
      }
    });
  }

  // ── Sub-interfaces ───────────────────────────────────────────────────────
  for (const device of devices.values()) {
    const site = device.siteId ? siteById.get(device.siteId) : undefined;
    const expanded: RInterface[] = [];
    device.interfaces.forEach((iface, index) => {
      expanded.push(iface);
      const rawSubs = device.raw.interfaces?.[index]?.subinterfaces;
      if (rawSubs === undefined) return;
      const wanted =
        rawSubs === 'auto'
          ? [...(site?.vlans ?? [])].sort((a, b) => a.id - b.id).map((v) => ({ vlan: v.id, address: undefined as string | undefined, path: [...iface.path, 'subinterfaces'] as Path }))
          : rawSubs.map((s, si) => ({ vlan: s.vlan, address: s.address, path: [...iface.path, 'subinterfaces', si] as Path }));
      for (const sub of wanted) {
        const vlan = site?.vlans.find((v) => v.id === sub.vlan);
        const explicit = cidrOf(sub.address);
        let address: Val<Cidr> | undefined;
        let source: AddressSource | undefined;
        if (explicit) {
          address = given(explicit);
          source = 'subinterface';
        } else if (vlan?.gateway && vlan.subnet) {
          address = derived({ ip: vlan.gateway.value, prefix: vlan.subnet.value.prefix });
          source = 'vlan-gateway';
        }
        expanded.push({
          deviceId: device.id,
          name: `${iface.name}.${sub.vlan}`,
          path: sub.path,
          addressPath: explicit ? [...sub.path, 'address'] : sub.path,
          address,
          addressSource: source,
          role: 'lan',
          vlan: sub.vlan,
          parent: iface.name,
          hasSubinterfaces: false,
        });
      }
    });
    device.interfaces = expanded;
  }

  // ── Trunk defaults ───────────────────────────────────────────────────────
  for (const device of devices.values()) {
    const site = device.siteId ? siteById.get(device.siteId) : undefined;
    for (const port of device.ports) {
      if (port.mode !== 'trunk') continue;
      port.allowed = port.raw.allowed
        ? given(port.raw.allowed)
        : derived((site?.vlans ?? []).map((v) => v.id).sort((a, b) => a - b));
    }
  }

  // ── Tunnels ──────────────────────────────────────────────────────────────
  const tunnels: RTunnel[] = (raw.tunnels ?? []).map((tunnel, ti) => {
    const path: Path = ['tunnels', ti];
    const subnet = tunnelSubnets[ti];
    const p2p = tunnel.p2p ?? false;
    const info = subnet ? subnetInfo(subnet, { p2p }) : undefined;
    const end = (side: 'a' | 'b', index: number): RTunnelEnd => {
      const rawEnd = tunnel[side];
      const device = devices.get(rawEnd.device);
      const site = device?.siteId ? siteById.get(device.siteId) : undefined;
      const explicit = hostOf(rawEnd.address);
      let address: Val<Ip> | undefined;
      if (explicit !== undefined) address = given(explicit);
      else if (info && info.firstUsable !== null && info.usable >= 2) address = derived(info.firstUsable + index);

      const rawProtected = tunnel.protected?.[side] ?? 'auto';
      const protectedNets: Val<Subnet[]> =
        rawProtected === 'auto'
          ? derived([...(site?.vlans ?? []), ...(site?.lans ?? [])].flatMap((n) => (n.subnet ? [n.subnet.value] : [])))
          : given(rawProtected.flatMap((text) => {
              const cidr = cidrOf(text);
              return cidr ? [toSubnet(cidr)] : [];
            }));
      return {
        path: [...path, side],
        deviceId: rawEnd.device,
        underlay: rawEnd.underlay,
        siteId: site?.id,
        peerIp: findInterface(rawEnd.device, rawEnd.underlay)?.address?.value.ip,
        address,
        protected: protectedNets,
      };
    };
    return {
      raw: tunnel,
      path,
      id: tunnel.id,
      name: tunnel.name ?? tunnel.id,
      type: tunnel.type,
      subnet,
      info,
      p2p,
      a: end('a', 0),
      b: end('b', 1),
      routing: tunnel.routing ? given(tunnel.routing) : derived('static' as const),
      crypto: tunnel.crypto,
      locked: tunnel.locked ?? false,
    };
  });

  const model: ResolvedModel = {
    raw,
    meta: raw.meta ?? {},
    diagram: raw.diagram ?? {},
    transitPool,
    sites,
    external,
    links,
    tunnels,
    devices,
    connections: [],
  };
  model.connections = resolveConnections(model);
  inferDeviceNetworks(model);
  return model;
}

/** What network the far end of a cable puts a device in. */
export type EndNetwork = { vlan: number } | { lan: string } | { trunk: true } | undefined;

/** The network at one end of a connection: an access port, a VLAN/LAN interface, or a device that sits in one network. */
export function networkAt(model: Pick<ResolvedModel, 'devices'>, end: REndpoint): EndNetwork {
  const device = model.devices.get(end.deviceId);
  if (!device) return undefined;
  if (!end.ifName) {
    if (device.vlan) return { vlan: device.vlan.value };
    if (device.lan) return { lan: device.lan.value };
    return undefined;
  }
  const ref = lookupRef(model, `${end.deviceId}:${end.ifName}`);
  if (ref?.iface) {
    if (ref.iface.lan !== undefined) return { lan: ref.iface.lan };
    if (ref.iface.vlan !== undefined) return { vlan: ref.iface.vlan };
    return undefined;
  }
  if (ref?.port) {
    if (ref.port.mode === 'trunk') return { trunk: true };
    return ref.port.vlan === undefined ? undefined : { vlan: ref.port.vlan };
  }
  return undefined;
}

/** The far ends of every connection that reaches the device itself (not one of its interfaces). */
export function deviceLevelPeers(model: Pick<ResolvedModel, 'connections'>, deviceId: string): REndpoint[] {
  const out: REndpoint[] = [];
  for (const c of model.connections) {
    if (c.a.deviceId === deviceId && !c.a.ifName) out.push(c.b);
    if (c.b.deviceId === deviceId && !c.b.ifName) out.push(c.a);
  }
  return out;
}

export const endNetworkKey = (n: EndNetwork): string | undefined =>
  n === undefined ? undefined : 'vlan' in n ? `vlan:${n.vlan}` : 'lan' in n ? `lan:${n.lan}` : 'trunk';

/**
 * Unmanaged devices (no ports, no interfaces, not a router) that do not say
 * which network they are in take it from what they are cabled to. Repeated so
 * that it follows a chain of unmanaged switches. Ambiguous cases stay unset;
 * validate.ts explains them.
 */
function inferDeviceNetworks(model: ResolvedModel): void {
  const candidates = [...model.devices.values()].filter(
    (d) => d.siteId && !d.vlan && !d.lan && d.ports.length === 0 && d.interfaces.length === 0 && !ROUTING_TYPES.has(d.type),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const device of candidates) {
      if (device.vlan || device.lan) continue;
      const found = new Map<string, EndNetwork>();
      for (const peer of deviceLevelPeers(model, device.id)) {
        const network = networkAt(model, peer);
        const key = endNetworkKey(network);
        if (key) found.set(key, network);
      }
      if (found.size !== 1) continue;
      const [network] = found.values();
      if (network && 'vlan' in network) device.vlan = derived(network.vlan);
      else if (network && 'lan' in network) device.lan = derived(network.lan);
      else continue;
      changed = true;
    }
  }
}

/** Physical connections: explicit `link:` cables, `links` entries, and WAN uplinks found by gateway address. */
function resolveConnections(model: ResolvedModel): RConnection[] {
  const connections: RConnection[] = [];
  const seen = new Set<string>();
  const keyOf = (e: REndpoint): string => `${e.deviceId}:${e.ifName ?? ''}`;
  const add = (connection: RConnection): void => {
    const pair = [keyOf(connection.a), keyOf(connection.b)].sort().join(' <-> ');
    if (seen.has(pair)) return;
    seen.add(pair);
    connections.push(connection);
  };
  const endpointOf = (deviceId: string, ifName?: string): REndpoint => {
    const iface = ifName ? model.devices.get(deviceId)?.interfaces.find((i) => i.name === ifName) : undefined;
    return { deviceId, ifName, ip: iface?.address?.value.ip };
  };

  for (const link of model.links) {
    if (!model.devices.has(link.a.deviceId) || !model.devices.has(link.b.deviceId)) continue;
    add({
      kind: 'link',
      name: link.name,
      subnet: link.subnet?.value,
      a: { deviceId: link.a.deviceId, ifName: link.a.ifName, ip: link.a.address?.value },
      b: { deviceId: link.b.deviceId, ifName: link.b.ifName, ip: link.b.address?.value },
    });
  }

  for (const device of model.devices.values()) {
    const cable = (fromName: string | undefined, target: string | undefined, fromPort?: RPort): void => {
      if (!target) return;
      const ref = lookupRef(model, target);
      if (!ref) return;
      const trunk = fromPort?.mode === 'trunk' ? fromPort : ref.port?.mode === 'trunk' ? ref.port : undefined;
      add({
        kind: 'cable',
        a: endpointOf(device.id, fromName),
        b: endpointOf(ref.device.id, ref.ifName),
        trunkVlans: trunk?.allowed?.value,
      });
    };
    for (const iface of device.interfaces) cable(iface.name, iface.link);
    for (const port of device.ports) cable(port.raw.range, port.link, port);
    cable(undefined, device.uplink);
  }

  // A WAN uplink is drawn to whichever interface owns the gateway address.
  const connected = new Set(connections.flatMap((c) => [keyOf(c.a), keyOf(c.b)]));
  for (const wan of model.sites.flatMap((s) => s.wans)) {
    if (wan.gateway === undefined || !model.devices.has(wan.deviceId)) continue;
    if (connected.has(`${wan.deviceId}:${wan.ifName}`)) continue;
    for (const device of model.devices.values()) {
      const peer = device.interfaces.find((i) => i.address?.value.ip === wan.gateway && device.id !== wan.deviceId);
      if (!peer) continue;
      add({
        kind: 'wan',
        name: wan.name,
        subnet: wan.subnet,
        a: { deviceId: wan.deviceId, ifName: wan.ifName, ip: wan.address?.ip },
        b: { deviceId: device.id, ifName: peer.name, ip: wan.gateway },
      });
      break;
    }
  }
  return connections;
}

/** Other end of the connection an interface or port takes part in, as `device:interface`. */
export function peerOf(model: ResolvedModel, deviceId: string, ifName: string): string | undefined {
  for (const c of model.connections) {
    const format = (e: REndpoint): string => (e.ifName ? `${e.deviceId}:${e.ifName}` : e.deviceId);
    if (c.a.deviceId === deviceId && (c.a.ifName ?? '') === ifName) return format(c.b);
    if (c.b.deviceId === deviceId && (c.b.ifName ?? '') === ifName) return format(c.a);
  }
  return undefined;
}

