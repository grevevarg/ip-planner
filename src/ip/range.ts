import { blockSize, formatIp, parseIp, type Ip } from './addr';
import { broadcastOf, type Subnet } from './subnet';

/** An inclusive run of addresses. */
export interface IpRange {
  start: Ip;
  end: Ip;
}

/** Parses `a.b.c.d` (a single address) or `a.b.c.d-e.f.g.h`. Null when malformed or reversed. */
export function parseRange(text: string): IpRange | null {
  const dash = text.indexOf('-');
  if (dash < 0) {
    const ip = parseIp(text.trim());
    return ip === null ? null : { start: ip, end: ip };
  }
  const start = parseIp(text.slice(0, dash).trim());
  const end = parseIp(text.slice(dash + 1).trim());
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

export function formatRange(range: IpRange): string {
  return range.start === range.end
    ? formatIp(range.start)
    : `${formatIp(range.start)}-${formatIp(range.end)}`;
}

export function rangeSize(range: IpRange): number {
  return range.end - range.start + 1;
}

export function rangeContains(range: IpRange, ip: Ip): boolean {
  return ip >= range.start && ip <= range.end;
}

export function rangeOfSubnet(subnet: Subnet): IpRange {
  return { start: subnet.network, end: broadcastOf(subnet) };
}

/** Sorts ranges and merges the ones that touch or overlap. */
export function mergeRanges(ranges: IpRange[]): IpRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: IpRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/** Removes every address in `remove` from `base`, returning what is left in order. */
export function subtractRanges(base: IpRange, remove: IpRange[]): IpRange[] {
  const result: IpRange[] = [];
  let cursor = base.start;
  for (const hole of mergeRanges(remove)) {
    if (hole.end < cursor) continue;
    if (hole.start > base.end) break;
    if (hole.start > cursor) result.push({ start: cursor, end: hole.start - 1 });
    cursor = hole.end + 1;
  }
  if (cursor <= base.end) result.push({ start: cursor, end: base.end });
  return result;
}

/** Splits an arbitrary range into the fewest aligned CIDR blocks that cover it exactly. */
export function rangeToSubnets(range: IpRange): Subnet[] {
  const subnets: Subnet[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    let prefix = 32;
    // Grow the block while it stays aligned on `cursor` and inside the range.
    while (prefix > 0) {
      const size = blockSize(prefix - 1);
      if (cursor % size !== 0 || cursor + size - 1 > range.end) break;
      prefix--;
    }
    subnets.push({ network: cursor, prefix });
    cursor += blockSize(prefix);
  }
  return subnets;
}
