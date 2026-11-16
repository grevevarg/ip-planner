import { blockSize, formatIp, maskOf, wildcardOf, type Cidr, type Ip } from './addr';

/** A network: `network` always sits on the block boundary for `prefix`. */
export interface Subnet {
  network: Ip;
  prefix: number;
}

export interface SubnetOptions {
  /**
   * Treat the block as a point-to-point link. Only matters for /31, which then
   * has two usable addresses (RFC 3021) instead of none.
   */
  p2p?: boolean;
}

/** Everything the plan tables show about one subnet. */
export interface SubnetInfo extends Subnet {
  mask: Ip;
  wildcard: Ip;
  broadcast: Ip;
  /** Total number of addresses in the block. */
  size: number;
  /** Number of addresses that can be given to hosts (including the gateway). */
  usable: number;
  /** First and last host address; null when the block has no usable addresses. */
  firstUsable: Ip | null;
  lastUsable: Ip | null;
}

export function networkOf(cidr: Cidr): Ip {
  return (cidr.ip & maskOf(cidr.prefix)) >>> 0;
}

export function broadcastOf(subnet: Subnet): Ip {
  return (subnet.network | wildcardOf(subnet.prefix)) >>> 0;
}

/** True when the written address has no host bits set (10.10.1.0/26 yes, 10.10.1.5/26 no). */
export function isNetworkAddress(cidr: Cidr): boolean {
  return networkOf(cidr) === cidr.ip;
}

/** Normalises a CIDR to the subnet that contains it. */
export function toSubnet(cidr: Cidr): Subnet {
  return { network: networkOf(cidr), prefix: cidr.prefix };
}

export function formatSubnet(subnet: Subnet): string {
  return `${formatIp(subnet.network)}/${subnet.prefix}`;
}

/**
 * Number of host addresses in a block.
 *  - /0 … /30: size − 2 (network and broadcast are reserved)
 *  - /31: 0, or 2 when `p2p` is set
 *  - /32: 1 (a single host route, e.g. a loopback)
 */
export function usableCount(prefix: number, options: SubnetOptions = {}): number {
  if (prefix === 32) return 1;
  if (prefix === 31) return options.p2p ? 2 : 0;
  return blockSize(prefix) - 2;
}

export function subnetInfo(subnet: Subnet, options: SubnetOptions = {}): SubnetInfo {
  const { network, prefix } = subnet;
  const broadcast = broadcastOf(subnet);
  const usable = usableCount(prefix, options);
  let firstUsable: Ip | null = null;
  let lastUsable: Ip | null = null;
  if (usable > 0) {
    // /31 p2p and /32 have no reserved network/broadcast address.
    const reserved = prefix >= 31 ? 0 : 1;
    firstUsable = network + reserved;
    lastUsable = broadcast - reserved;
  }
  return {
    network,
    prefix,
    mask: maskOf(prefix),
    wildcard: wildcardOf(prefix),
    broadcast,
    size: blockSize(prefix),
    usable,
    firstUsable,
    lastUsable,
  };
}

/** True when `ip` lies inside the block (network and broadcast included). */
export function contains(subnet: Subnet, ip: Ip): boolean {
  return ip >= subnet.network && ip <= broadcastOf(subnet);
}

/** True when `inner` lies completely inside `outer` (equal blocks count). */
export function containsSubnet(outer: Subnet, inner: Subnet): boolean {
  return inner.prefix >= outer.prefix && contains(outer, inner.network);
}

/** True when the two blocks share at least one address. */
export function overlaps(a: Subnet, b: Subnet): boolean {
  return a.network <= broadcastOf(b) && b.network <= broadcastOf(a);
}

export function sameSubnet(a: Subnet, b: Subnet): boolean {
  return a.network === b.network && a.prefix === b.prefix;
}

/**
 * True when `ip` is the network or broadcast address of the block and therefore
 * cannot be given to a host. Never true for /31 and /32.
 */
export function isReservedAddress(subnet: Subnet, ip: Ip): boolean {
  if (subnet.prefix >= 31) return false;
  return ip === subnet.network || ip === broadcastOf(subnet);
}

/**
 * Longest prefix (smallest block) whose usable count is at least `hosts`.
 * Never returns /32, and returns /31 only for `p2p` with at most two hosts.
 * Returns null when not even a /0 is big enough or `hosts` is not a positive integer.
 */
export function prefixForHosts(hosts: number, options: SubnetOptions = {}): number | null {
  if (!Number.isInteger(hosts) || hosts < 1) return null;
  for (let prefix = options.p2p ? 31 : 30; prefix >= 0; prefix--) {
    if (usableCount(prefix, options) >= hosts) return prefix;
  }
  return null;
}
