/* eslint-disable */
/**
 * GENERATED from src/model/schema.json by scripts/gen-types.ts.
 * Do not edit by hand; run `npm run gen:types`.
 */

/**
 * An IPv4 address with a prefix length. For a subnet the address must be the network address; for an interface it is the interface's own address.
 */
export type CIDR = string;
/**
 * A stable identifier: lowercase letters, digits and hyphens, starting with a letter or digit. Used to refer to the object from elsewhere in the file.
 */
export type Slug = string;
/**
 * A reference to the other end of a cable: `device-id:interface-name` (an interface or switch port of that device), or just `device-id` for nodes without interfaces such as a cloud.
 */
export type LinkTarget = string;
/**
 * An IPv4 address in dotted-quad notation, without a prefix length.
 */
export type IPv4Address = string;
/**
 * An IPv4 address, optionally followed by a prefix length. When the prefix is given it must match the subnet the address lives in.
 */
export type Address = string;
/**
 * Either `auto` or an explicit list of networks.
 */
export type ProtectedSide = 'auto' | CIDR[];

/**
 * One YAML file describing a lab network: sites, VLANs, subnets, devices, interfaces, point-to-point links and VPN tunnels. The plan tables and the topology diagram are both generated from it.
 */
export interface Netplan {
  /**
   * Schema version of the file. Must be 1.
   */
  version: 1;
  /**
   * Title block shown on the cover of the plan and in the page footer of the PDF.
   */
  meta?: Meta;
  /**
   * Settings for the generated D2 topology diagram.
   */
  diagram?: Diagram;
  /**
   * Address block that point-to-point links without their own `subnet` are auto-allocated from (a /30 each, or a /31 when the link sets `p2p: true`). Leave it out if every link has an explicit subnet.
   */
  transit_pool?: CIDR;
  /**
   * Networks you connect to but do not own, for example the ISP. Their devices appear in the topology and their addresses take part in overlap and duplicate checks.
   */
  external?: ExternalGroup[];
  /**
   * The sites (companies, offices, labs) you are planning. Each site gets its own section in the plan and its own container in the topology.
   */
  sites?: Site[];
  /**
   * Point-to-point links between two device interfaces that are neither a site WAN connection nor a VLAN, for example a leased line or a cable between two routers.
   */
  links?: Link[];
  /**
   * VPN tunnels between two devices. Drawn dashed in the topology and listed in the VPN section of the plan.
   */
  tunnels?: Tunnel[];
  /**
   * The values you were given for locked objects, keyed by the object's id (for a VLAN use `<site-id>:<vlan-id>`, e.g. `linky:10`). Each value is a copy of the object exactly as it was handed out. When an object marked `locked: true` no longer matches its baseline, the app reports `LOCKED_CHANGED`. The `locked` flag itself is ignored in the comparison.
   */
  locked_baseline?: {
    /**
     * A copy of the locked object as it was given.
     */
    [k: string]: {};
  };
}
/**
 * Document information shown on the cover of the plan.
 */
export interface Meta {
  /**
   * Title of the plan. Also used in the PDF footer and as the suggested file name when saving.
   */
  title?: string;
  /**
   * People who wrote the plan.
   */
  authors?: string[];
  /**
   * Date of the plan in ISO format (YYYY-MM-DD).
   */
  date?: string;
  /**
   * Free text shown on the cover, for example assumptions or constraints given in the assignment.
   */
  notes?: string;
}
/**
 * Settings for the generated D2 topology diagram.
 */
export interface Diagram {
  /**
   * Layout engine that positions the nodes.
   */
  layout?: 'dagre' | 'elk';
  /**
   * Direction the diagram flows in.
   */
  direction?: 'up' | 'down' | 'left' | 'right';
  /**
   * Visual theme of the diagram. Printing always uses the diagram as rendered on screen.
   */
  theme?: 'default' | 'dark' | 'sketch';
  /**
   * Raw D2 source appended verbatim after the generated diagram. Use it to add notes or override styles without changing the generator.
   */
  extra_d2?: string;
}
/**
 * A group of devices you connect to but do not own, such as an ISP. Drawn as a container with a red dashed border.
 */
export interface ExternalGroup {
  /**
   * Identifier of the group. Must be unique among all sites, external groups, devices, links and tunnels.
   */
  id: Slug;
  /**
   * Display name. Defaults to the id.
   */
  name?: string;
  /**
   * Marks the group as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id.
   */
  locked?: boolean;
  /**
   * Free text shown next to the group in the plan.
   */
  notes?: string;
  /**
   * Devices that belong to the group.
   */
  devices?: Device[];
}
/**
 * A network device or host. Routers and hosts list `interfaces`; switches list `ports` (and may also have interfaces, for example a management SVI).
 */
export interface Device {
  /**
   * Identifier of the device. Must be unique among all sites, external groups, devices, links and tunnels. Used in references such as `linky-r1:f0/0`.
   */
  id: Slug;
  /**
   * Display name (for example the hostname). Defaults to the id.
   */
  name?: string;
  /**
   * Kind of device. Decides the default icon in the topology.
   */
  type: 'router' | 'switch' | 'l3switch' | 'firewall' | 'ap' | 'server' | 'pc' | 'cloud' | 'isp';
  /**
   * Icon used in the topology. A built-in icon name (`router`), a path relative to the site root (`icons/custom/fw.svg`), or an absolute `https://` URL (passed through as-is; may not print). Defaults to the device type.
   */
  icon?: string;
  /**
   * Routed interfaces of the device. Interface names must be unique within the device.
   */
  interfaces?: Interface[];
  /**
   * Switch ports of the device, given as ranges that share the same configuration.
   */
  ports?: Port[];
  /**
   * Marks the device as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id.
   */
  locked?: boolean;
  /**
   * Free text about the device.
   */
  notes?: string;
}
/**
 * A routed interface. Its address may be written here, or come from the site `wan`, from a `links` entry that names it as an endpoint, or from its sub-interfaces.
 */
export interface Interface {
  /**
   * Interface name as used on the device, without spaces.
   */
  name: string;
  /**
   * Address and prefix of the interface. Omit it for interfaces whose address comes from the site `wan` or from a link.
   */
  address?: CIDR;
  /**
   * What the interface is used for. Shown in the interface table.
   */
  role?: 'wan' | 'lan' | 'trunk' | 'p2p' | 'mgmt' | 'loopback';
  /**
   * VLAN id (of the device's site) that this interface sits in, for example a switch SVI or a server NIC. The address must then be inside that VLAN's subnet.
   */
  vlan?: number;
  /**
   * What the interface is cabled to. Draws a connection in the topology.
   */
  link?: LinkTarget;
  /**
   * 802.1Q sub-interfaces. `auto` creates one `<name>.<vlan>` sub-interface per VLAN of the site, each with the VLAN's gateway address. A list creates only the ones named.
   */
  subinterfaces?: 'auto' | Subinterface[];
  /**
   * Free text shown in the interface table.
   */
  description?: string;
}
/**
 * One 802.1Q sub-interface, named `<interface>.<vlan>`.
 */
export interface Subinterface {
  /**
   * VLAN id (of the device's site) carried by the sub-interface.
   */
  vlan: number;
  /**
   * Address of the sub-interface. Defaults to the VLAN's gateway.
   */
  address?: CIDR;
}
/**
 * One switch port or a range of ports with the same configuration.
 */
export interface Port {
  /**
   * A single port (`g0/1`) or a range over the last number (`f0/1-10`).
   */
  range: string;
  /**
   * Switchport mode.
   */
  mode: 'access' | 'trunk';
  /**
   * Access VLAN id. Used with `mode: access`.
   */
  vlan?: number;
  /**
   * VLAN ids allowed on the trunk. Used with `mode: trunk`. Defaults to all VLANs of the site.
   */
  allowed?: number[];
  /**
   * What the port is cabled to. Only meaningful for a single port, not a range. Draws a connection in the topology.
   */
  link?: LinkTarget;
  /**
   * Free text shown in the switchport table.
   */
  description?: string;
}
/**
 * One site: an address block, its VLANs and its devices.
 */
export interface Site {
  /**
   * Identifier of the site. Must be unique among all sites, external groups, devices, links and tunnels.
   */
  id: Slug;
  /**
   * Display name. Defaults to the id.
   */
  name?: string;
  /**
   * Address block that every VLAN subnet of the site must fit inside. VLANs without a `subnet` are auto-allocated from it.
   */
  supernet: CIDR;
  /**
   * Colour of the site's header band in the plan and of its container in the topology, as a six-digit hex colour.
   */
  color?: string;
  /**
   * The site's connection to the outside world.
   */
  wan?: Wan;
  /**
   * VLANs of the site. VLAN ids must be unique within the site.
   */
  vlans?: Vlan[];
  /**
   * Devices located at the site.
   */
  devices?: Device[];
  /**
   * Marks the site as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id.
   */
  locked?: boolean;
  /**
   * Free text shown under the site heading in the plan.
   */
  notes?: string;
}
/**
 * A site's uplink: which interface faces the provider, its address and the next hop.
 */
export interface Wan {
  /**
   * Id of the device that holds the WAN interface. Must be a device of this site.
   */
  device: Slug;
  /**
   * Name of the WAN interface on that device. The interface must be listed under the device's `interfaces`.
   */
  interface: string;
  /**
   * Address and prefix of the WAN interface. May be given on the interface itself instead; if both are given they must be equal.
   */
  address?: CIDR;
  /**
   * Next-hop address of the provider. Must be inside the WAN subnet. If another device has an interface with this address, the topology draws the WAN connection to it.
   */
  gateway?: IPv4Address;
  /**
   * Whether the site's private addresses are translated (NAT/PAT) on this interface.
   */
  nat?: boolean;
}
/**
 * A VLAN and its subnet. Give either `hosts` (the subnet is then auto-allocated inside the site supernet) or an explicit `subnet`, or both.
 */
export interface Vlan {
  /**
   * VLAN id, 1–4094. Ids 1002–1005 are reserved on Cisco equipment and are rejected. Must be unique within the site.
   */
  id: number;
  /**
   * Name of the VLAN.
   */
  name?: string;
  /**
   * Number of host addresses needed, including the gateway. Decides the size of an auto-allocated subnet and is checked against the size of an explicit one.
   */
  hosts?: number;
  /**
   * Extra headroom added to `hosts` when sizing an auto-allocated subnet, in percent (rounded up to whole hosts).
   */
  growth_percent?: number;
  /**
   * Subnet of the VLAN. Must be a network address inside the site supernet. If omitted, the smallest subnet that fits `hosts` is auto-allocated (largest VLANs first, then by VLAN id).
   */
  subnet?: CIDR;
  /**
   * Default gateway of the VLAN. Defaults to the first usable address of the subnet.
   */
  gateway?: Address;
  /**
   * How hosts in the VLAN get their addresses. Omit for VLANs that are addressed statically only.
   */
  dhcp?: Dhcp;
  /**
   * Whether this VLAN is the native (untagged) VLAN on trunks.
   */
  native?: boolean;
  /**
   * Addresses in the VLAN that are assigned by hand, such as servers, printers and switch management addresses.
   */
  static?: StaticEntry[];
  /**
   * Free text shown in the Notes column of the VLAN table.
   */
  notes?: string;
  /**
   * Marks the VLAN as given and not to be changed. Its baseline key in `locked_baseline` is `<site-id>:<vlan-id>`.
   */
  locked?: boolean;
}
/**
 * DHCP settings of a VLAN.
 */
export interface Dhcp {
  /**
   * Where DHCP leases for the VLAN come from.
   */
  mode: 'server' | 'relay' | 'none';
  /**
   * Id of the device that runs the DHCP pool. Used with `mode: server`.
   */
  on?: Slug;
  /**
   * Address of the DHCP server. With `mode: relay` it is where requests are relayed to, and a warning is shown if it is not inside any subnet of the same site. With `mode: server` it is optional and names a server that sits in this VLAN, so it must be inside the VLAN's subnet.
   */
  server?: IPv4Address;
  /**
   * Range of addresses handed out. Defaults to the address after the gateway up to the last usable address.
   */
  pool?: Pool;
  /**
   * Addresses or ranges inside the pool that must not be handed out. Each entry is a single address or `first-last`.
   */
  exclude?: string[];
}
/**
 * An inclusive range of addresses handed out by DHCP.
 */
export interface Pool {
  /**
   * First address of the pool.
   */
  start: IPv4Address;
  /**
   * Last address of the pool.
   */
  end: IPv4Address;
}
/**
 * One hand-assigned address in a VLAN.
 */
export interface StaticEntry {
  /**
   * What the address belongs to. If it equals the id or name of a device that has the same address on an interface, the two are treated as the same assignment rather than a duplicate.
   */
  name: string;
  /**
   * The assigned address. Must be a host address inside the VLAN subnet and outside the DHCP pool.
   */
  ip: IPv4Address;
  /**
   * Free text describing what the host does.
   */
  role?: string;
}
/**
 * A point-to-point link between two interfaces with its own small subnet.
 */
export interface Link {
  /**
   * Identifier of the link. Must be unique among all sites, external groups, devices, links and tunnels.
   */
  id: Slug;
  /**
   * Display name. Defaults to the id.
   */
  name?: string;
  /**
   * Subnet of the link. If omitted, it is auto-allocated from the top-level `transit_pool`.
   */
  subnet?: CIDR;
  /**
   * Allow a /31 subnet (RFC 3021), which has two usable addresses and no network or broadcast address. Without it a /31 is rejected.
   */
  p2p?: boolean;
  /**
   * First end of the link. Gets the first usable address unless `address` is given.
   */
  a: LinkEnd;
  /**
   * Second end of the link. Gets the second usable address unless `address` is given.
   */
  b: LinkEnd;
  /**
   * Marks the link as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id.
   */
  locked?: boolean;
  /**
   * Free text about the link.
   */
  notes?: string;
}
/**
 * One end of a point-to-point link.
 */
export interface LinkEnd {
  /**
   * The interface at this end, as `device-id:interface-name`. The interface must be listed under the device's `interfaces`.
   */
  endpoint: string;
  /**
   * Address of this end. Defaults to the first (side a) or second (side b) usable address of the link subnet.
   */
  address?: Address;
}
/**
 * A VPN tunnel between two devices. Never put keys in the file: `crypto.psk_ref` is a free-text pointer to where the key comes from.
 */
export interface Tunnel {
  /**
   * Identifier of the tunnel. Must be unique among all sites, external groups, devices, links and tunnels.
   */
  id: Slug;
  /**
   * Display name. Defaults to the id.
   */
  name?: string;
  /**
   * Tunnel technology. Decides whether the tunnel has its own subnet.
   */
  type: 'ipsec-policy' | 'ipsec-vti' | 'gre' | 'gre-ipsec' | 'wireguard';
  /**
   * First end of the tunnel. Gets the first usable address of `subnet` unless `address` is given.
   */
  a: TunnelEnd;
  /**
   * Second end of the tunnel. Gets the second usable address of `subnet` unless `address` is given.
   */
  b: TunnelEnd;
  /**
   * Subnet of the tunnel interfaces. Required for every type except `ipsec-policy`, where it is forbidden. Must not overlap any other subnet in the file.
   */
  subnet?: CIDR;
  /**
   * Allow a /31 tunnel subnet (RFC 3021).
   */
  p2p?: boolean;
  /**
   * Networks behind each end that are reachable through the tunnel. Defaults to `auto` on both sides.
   */
  protected?: ProtectedNetworks;
  /**
   * How routes to the protected networks are learned.
   */
  routing?: 'static' | 'ospf' | 'eigrp' | 'bgp';
  /**
   * Encryption parameters. Not used by plain `gre`.
   */
  crypto?: Crypto;
  /**
   * Marks the tunnel as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id.
   */
  locked?: boolean;
  /**
   * Free text about the tunnel.
   */
  notes?: string;
}
/**
 * One end of a tunnel.
 */
export interface TunnelEnd {
  /**
   * Id of the device that terminates the tunnel.
   */
  device: Slug;
  /**
   * Name of the interface on that device the tunnel is sourced from. Its address is the peer address the other side connects to, so it needs an address and should be a WAN or link interface.
   */
  underlay: string;
  /**
   * Address of the tunnel interface at this end. Defaults to the first (side a) or second (side b) usable address of the tunnel subnet.
   */
  address?: Address;
}
/**
 * The networks behind each end of a tunnel. The two sides must not overlap.
 */
export interface ProtectedNetworks {
  /**
   * Networks behind side a.
   */
  a?: ProtectedSide;
  /**
   * Networks behind side b.
   */
  b?: ProtectedSide;
}
/**
 * Encryption parameters of a tunnel. Documentation only; nothing is generated from them. Secrets do not belong here.
 */
export interface Crypto {
  /**
   * IKE version.
   */
  ike?: 1 | 2;
  /**
   * Encryption algorithm, as free text.
   */
  encryption?: string;
  /**
   * Integrity (hash) algorithm, as free text.
   */
  integrity?: string;
  /**
   * Diffie-Hellman group number.
   */
  dh_group?: number;
  /**
   * Lifetime of the security association in seconds.
   */
  lifetime_s?: number;
  /**
   * Where the pre-shared key comes from, as free text. Never the key itself.
   */
  psk_ref?: string;
}
