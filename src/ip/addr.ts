/**
 * IPv4 address primitives. Addresses are unsigned 32-bit integers stored in a
 * JS number. Everything here is pure (no DOM) so IPv6 can later be added next
 * to it without touching the rest of the app.
 */

/** An IPv4 address as an unsigned 32-bit integer. */
export type Ip = number;

/** An address with a prefix length, exactly as written (the address may have host bits set). */
export interface Cidr {
  ip: Ip;
  prefix: number;
}

const OCTET = /^(0|[1-9]\d{0,2})$/;

/** Parses dotted-quad notation. Returns null for anything that is not a strict IPv4 address. */
export function parseIp(text: string): Ip | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

export function formatIp(ip: Ip): string {
  return [ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255].join('.');
}

/** Parses `a.b.c.d/n`. Host bits are kept; use `networkOf` to normalise. */
export function parseCidr(text: string): Cidr | null {
  const slash = text.indexOf('/');
  if (slash < 0) return null;
  const ip = parseIp(text.slice(0, slash));
  const prefixText = text.slice(slash + 1);
  if (ip === null || !/^(0|[1-9]\d?)$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > 32) return null;
  return { ip, prefix };
}

export function formatCidr(cidr: Cidr): string {
  return `${formatIp(cidr.ip)}/${cidr.prefix}`;
}

/** Number of addresses in a block of the given prefix length (2^(32-prefix)). */
export function blockSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

/** Subnet mask for a prefix length, e.g. 26 → 255.255.255.192. */
export function maskOf(prefix: number): Ip {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Wildcard (inverse) mask for a prefix length, e.g. 26 → 0.0.0.63. */
export function wildcardOf(prefix: number): Ip {
  return (~maskOf(prefix)) >>> 0;
}

/** Prefix length for a contiguous subnet mask, or null if the mask has holes. */
export function prefixOfMask(mask: Ip): number | null {
  for (let prefix = 0; prefix <= 32; prefix++) {
    if (maskOf(prefix) === mask) return prefix;
  }
  return null;
}
