import { blockSize } from './addr';
import { mergeRanges, rangeOfSubnet, rangeSize, rangeToSubnets, subtractRanges } from './range';
import { broadcastOf, overlaps, type Subnet } from './subnet';

/**
 * Lowest-addressed free block of the given prefix inside `pool` that does not
 * overlap anything in `taken`. Null when the pool has no room (or the prefix is
 * shorter than the pool's own).
 */
export function firstFit(pool: Subnet, taken: Subnet[], prefix: number): Subnet | null {
  if (prefix < pool.prefix || prefix > 32) return null;
  const size = blockSize(prefix);
  const poolEnd = broadcastOf(pool);
  let network = pool.network;
  while (network + size - 1 <= poolEnd) {
    const candidate: Subnet = { network, prefix };
    const clash = taken.find((t) => overlaps(t, candidate));
    if (!clash) return candidate;
    // Skip to the first aligned block that starts after the clashing subnet.
    const next = broadcastOf(clash) + 1;
    network = Math.ceil(next / size) * size;
  }
  return null;
}

export interface AllocRequest {
  /** Caller's handle for the request; returned in the result maps. */
  key: string;
  /** Prefix length of the block wanted. */
  prefix: number;
  /** Tie-breaker between requests of the same size (e.g. the VLAN id). */
  order: number;
}

export interface AllocResult {
  allocated: Map<string, Subnet>;
  /** Keys that did not fit in the pool. */
  failed: string[];
}

/**
 * VLSM allocation: places the largest blocks first (ties broken by `order`,
 * then `key`), each at the lowest free address. The same input always gives
 * the same output, whatever order the requests are listed in.
 */
export function allocateVlsm(pool: Subnet, reserved: Subnet[], requests: AllocRequest[]): AllocResult {
  const taken = [...reserved];
  const allocated = new Map<string, Subnet>();
  const failed: string[] = [];
  const sorted = [...requests].sort(
    (a, b) => a.prefix - b.prefix || a.order - b.order || Number(a.key > b.key) - Number(a.key < b.key),
  );
  for (const request of sorted) {
    const block = firstFit(pool, taken, request.prefix);
    if (block) {
      allocated.set(request.key, block);
      taken.push(block);
    } else {
      failed.push(request.key);
    }
  }
  return { allocated, failed };
}

/** The parts of `pool` not covered by any subnet in `used`, as the fewest CIDR blocks, in address order. */
export function freeBlocks(pool: Subnet, used: Subnet[]): Subnet[] {
  const holes = used.filter((u) => overlaps(u, pool)).map(rangeOfSubnet);
  return subtractRanges(rangeOfSubnet(pool), holes).flatMap(rangeToSubnets);
}

/** Number of addresses in `pool` covered by at least one subnet in `used` (overlaps counted once). */
export function usedAddressCount(pool: Subnet, used: Subnet[]): number {
  const poolRange = rangeOfSubnet(pool);
  const clipped = used
    .filter((u) => overlaps(u, pool))
    .map(rangeOfSubnet)
    .map((r) => ({ start: Math.max(r.start, poolRange.start), end: Math.min(r.end, poolRange.end) }));
  return mergeRanges(clipped).reduce((sum, r) => sum + rangeSize(r), 0);
}
