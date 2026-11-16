import { describe, expect, it } from 'vitest';
import {
  allocateVlsm,
  blockSize,
  broadcastOf,
  contains,
  containsSubnet,
  firstFit,
  formatCidr,
  formatIp,
  formatRange,
  formatSubnet,
  freeBlocks,
  isNetworkAddress,
  isReservedAddress,
  maskOf,
  mergeRanges,
  networkOf,
  overlaps,
  parseCidr,
  parseIp,
  parseRange,
  prefixForHosts,
  prefixOfMask,
  rangeContains,
  rangeOfSubnet,
  rangeSize,
  rangeToSubnets,
  sameSubnet,
  subnetInfo,
  subtractRanges,
  toSubnet,
  usableCount,
  usedAddressCount,
  wildcardOf,
  type Subnet,
} from './index';

const ip = (s: string): number => parseIp(s)!;
const net = (s: string): Subnet => toSubnet(parseCidr(s)!);
const nets = (list: Subnet[]): string[] => list.map(formatSubnet);

describe('parseIp / formatIp', () => {
  it('round-trips ordinary addresses', () => {
    for (const s of ['0.0.0.0', '10.10.1.5', '172.16.100.1', '192.168.0.254', '255.255.255.255']) {
      expect(formatIp(ip(s))).toBe(s);
    }
  });

  it('keeps the top bit unsigned', () => {
    expect(ip('255.255.255.255')).toBe(4294967295);
    expect(ip('128.0.0.0')).toBe(2147483648);
  });

  it.each(['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '01.2.3.4', '1.2.3.4 ', 'a.b.c.d', '1..2.3', '1.2.3.1000'])(
    'rejects %j',
    (s) => expect(parseIp(s)).toBeNull(),
  );
});

describe('parseCidr / formatCidr', () => {
  it('keeps host bits as written', () => {
    const c = parseCidr('10.10.1.5/26')!;
    expect(c.prefix).toBe(26);
    expect(formatCidr(c)).toBe('10.10.1.5/26');
  });

  it('accepts /0 and /32', () => {
    expect(parseCidr('0.0.0.0/0')).toEqual({ ip: 0, prefix: 0 });
    expect(parseCidr('10.0.0.1/32')!.prefix).toBe(32);
  });

  it.each(['10.0.0.0', '10.0.0.0/', '10.0.0.0/33', '10.0.0.0/-1', '10.0.0.0/08', '10.0.0/8', '10.0.0.0/8/8', '10.0.0.0/x'])(
    'rejects %j',
    (s) => expect(parseCidr(s)).toBeNull(),
  );
});

describe('masks', () => {
  it('computes masks and wildcards at the boundaries', () => {
    expect(formatIp(maskOf(0))).toBe('0.0.0.0');
    expect(formatIp(maskOf(1))).toBe('128.0.0.0');
    expect(formatIp(maskOf(26))).toBe('255.255.255.192');
    expect(formatIp(maskOf(32))).toBe('255.255.255.255');
    expect(formatIp(wildcardOf(0))).toBe('255.255.255.255');
    expect(formatIp(wildcardOf(26))).toBe('0.0.0.63');
    expect(formatIp(wildcardOf(32))).toBe('0.0.0.0');
  });

  it('maps masks back to prefixes', () => {
    expect(prefixOfMask(ip('255.255.255.192'))).toBe(26);
    expect(prefixOfMask(ip('0.0.0.0'))).toBe(0);
    expect(prefixOfMask(ip('255.0.255.0'))).toBeNull();
  });

  it('computes block sizes', () => {
    expect(blockSize(32)).toBe(1);
    expect(blockSize(24)).toBe(256);
    expect(blockSize(0)).toBe(4294967296);
  });
});

describe('network boundaries', () => {
  it('finds network and broadcast', () => {
    expect(formatIp(networkOf(parseCidr('10.10.1.5/26')!))).toBe('10.10.1.0');
    expect(formatIp(broadcastOf(net('10.10.1.0/26')))).toBe('10.10.1.63');
    expect(formatIp(broadcastOf(net('0.0.0.0/0')))).toBe('255.255.255.255');
    expect(formatIp(networkOf(parseCidr('255.255.255.255/1')!))).toBe('128.0.0.0');
  });

  it('detects addresses that are not on a network boundary', () => {
    expect(isNetworkAddress(parseCidr('10.10.1.0/26')!)).toBe(true);
    expect(isNetworkAddress(parseCidr('10.10.1.64/26')!)).toBe(true);
    expect(isNetworkAddress(parseCidr('10.10.1.5/26')!)).toBe(false);
    expect(isNetworkAddress(parseCidr('10.10.1.5/32')!)).toBe(true);
  });
});

describe('subnetInfo', () => {
  it('describes an ordinary /26', () => {
    const info = subnetInfo(net('10.10.1.0/26'));
    expect(formatIp(info.mask)).toBe('255.255.255.192');
    expect(formatIp(info.wildcard)).toBe('0.0.0.63');
    expect(formatIp(info.broadcast)).toBe('10.10.1.63');
    expect(formatIp(info.firstUsable!)).toBe('10.10.1.1');
    expect(formatIp(info.lastUsable!)).toBe('10.10.1.62');
    expect(info.usable).toBe(62);
    expect(info.size).toBe(64);
  });

  it('gives a /30 exactly two hosts', () => {
    const info = subnetInfo(net('10.255.0.0/30'));
    expect(info.usable).toBe(2);
    expect(formatIp(info.firstUsable!)).toBe('10.255.0.1');
    expect(formatIp(info.lastUsable!)).toBe('10.255.0.2');
    expect(formatIp(info.broadcast)).toBe('10.255.0.3');
  });

  it('treats /31 as unusable for hosts unless p2p', () => {
    const plain = subnetInfo(net('10.255.0.0/31'));
    expect(plain.usable).toBe(0);
    expect(plain.firstUsable).toBeNull();
    expect(plain.lastUsable).toBeNull();

    const p2p = subnetInfo(net('10.255.0.0/31'), { p2p: true });
    expect(p2p.usable).toBe(2);
    expect(formatIp(p2p.firstUsable!)).toBe('10.255.0.0');
    expect(formatIp(p2p.lastUsable!)).toBe('10.255.0.1');
  });

  it('treats /32 as a single host', () => {
    const info = subnetInfo(net('10.0.0.7/32'));
    expect(info.usable).toBe(1);
    expect(info.size).toBe(1);
    expect(formatIp(info.firstUsable!)).toBe('10.0.0.7');
    expect(formatIp(info.lastUsable!)).toBe('10.0.0.7');
    expect(formatIp(info.broadcast)).toBe('10.0.0.7');
  });

  it('handles /0', () => {
    const info = subnetInfo(net('0.0.0.0/0'));
    expect(info.usable).toBe(4294967294);
    expect(formatIp(info.firstUsable!)).toBe('0.0.0.1');
    expect(formatIp(info.lastUsable!)).toBe('255.255.255.254');
  });
});

describe('usableCount', () => {
  it('covers every special case', () => {
    expect(usableCount(24)).toBe(254);
    expect(usableCount(30)).toBe(2);
    expect(usableCount(31)).toBe(0);
    expect(usableCount(31, { p2p: true })).toBe(2);
    expect(usableCount(32)).toBe(1);
    expect(usableCount(32, { p2p: true })).toBe(1);
  });
});

describe('contains / containsSubnet / overlaps', () => {
  it('includes network and broadcast addresses', () => {
    const s = net('10.10.1.0/26');
    expect(contains(s, ip('10.10.1.0'))).toBe(true);
    expect(contains(s, ip('10.10.1.63'))).toBe(true);
    expect(contains(s, ip('10.10.1.64'))).toBe(false);
    expect(contains(s, ip('10.10.0.255'))).toBe(false);
  });

  it('works above 128.0.0.0 (no sign problems)', () => {
    const s = net('203.12.20.16/28');
    expect(contains(s, ip('203.12.20.30'))).toBe(true);
    expect(contains(s, ip('203.12.20.32'))).toBe(false);
    expect(contains(net('0.0.0.0/0'), ip('255.255.255.255'))).toBe(true);
  });

  it('checks subnet containment', () => {
    expect(containsSubnet(net('10.10.0.0/16'), net('10.10.1.0/26'))).toBe(true);
    expect(containsSubnet(net('10.10.0.0/16'), net('10.10.0.0/16'))).toBe(true);
    expect(containsSubnet(net('10.10.1.0/26'), net('10.10.0.0/16'))).toBe(false);
    expect(containsSubnet(net('10.10.0.0/16'), net('10.11.0.0/24'))).toBe(false);
  });

  it('detects overlap only when addresses are shared', () => {
    expect(overlaps(net('10.10.1.0/26'), net('10.10.1.0/24'))).toBe(true);
    expect(overlaps(net('10.10.1.0/24'), net('10.10.1.192/26'))).toBe(true);
    expect(overlaps(net('10.10.1.0/26'), net('10.10.1.0/26'))).toBe(true);
    expect(overlaps(net('10.10.1.0/26'), net('10.10.1.64/26'))).toBe(false);
    expect(overlaps(net('10.10.1.64/26'), net('10.10.1.0/26'))).toBe(false);
    expect(overlaps(net('0.0.0.0/0'), net('192.168.1.1/32'))).toBe(true);
  });

  it('compares subnets for equality', () => {
    expect(sameSubnet(net('10.0.0.0/24'), net('10.0.0.0/24'))).toBe(true);
    expect(sameSubnet(net('10.0.0.0/24'), net('10.0.0.0/25'))).toBe(false);
    expect(sameSubnet(net('10.0.0.0/24'), net('10.0.1.0/24'))).toBe(false);
  });
});

describe('isReservedAddress', () => {
  it('flags network and broadcast of ordinary subnets', () => {
    const s = net('10.10.1.0/26');
    expect(isReservedAddress(s, ip('10.10.1.0'))).toBe(true);
    expect(isReservedAddress(s, ip('10.10.1.63'))).toBe(true);
    expect(isReservedAddress(s, ip('10.10.1.1'))).toBe(false);
  });

  it('never flags /31 or /32', () => {
    expect(isReservedAddress(net('10.0.0.0/31'), ip('10.0.0.0'))).toBe(false);
    expect(isReservedAddress(net('10.0.0.0/31'), ip('10.0.0.1'))).toBe(false);
    expect(isReservedAddress(net('10.0.0.5/32'), ip('10.0.0.5'))).toBe(false);
  });
});

describe('prefixForHosts', () => {
  it.each([
    [1, 30],
    [2, 30],
    [3, 29],
    [6, 29],
    [7, 28],
    [14, 28],
    [15, 27],
    [40, 26],
    [60, 26],
    [62, 26],
    [63, 25],
    [254, 24],
    [255, 23],
  ])('%i hosts → /%i', (hosts, prefix) => expect(prefixForHosts(hosts)).toBe(prefix));

  it('uses /31 only for p2p', () => {
    expect(prefixForHosts(2, { p2p: true })).toBe(31);
    expect(prefixForHosts(1, { p2p: true })).toBe(31);
    expect(prefixForHosts(3, { p2p: true })).toBe(29);
  });

  it('rejects impossible requests', () => {
    expect(prefixForHosts(0)).toBeNull();
    expect(prefixForHosts(-5)).toBeNull();
    expect(prefixForHosts(1.5)).toBeNull();
    expect(prefixForHosts(2 ** 33)).toBeNull();
  });
});

describe('ranges', () => {
  it('parses single addresses and spans', () => {
    expect(parseRange('10.10.1.2')).toEqual({ start: ip('10.10.1.2'), end: ip('10.10.1.2') });
    expect(parseRange('10.10.1.2-10.10.1.19')).toEqual({ start: ip('10.10.1.2'), end: ip('10.10.1.19') });
    expect(parseRange('10.10.1.2 - 10.10.1.19')).toEqual({ start: ip('10.10.1.2'), end: ip('10.10.1.19') });
  });

  it('rejects malformed and reversed ranges', () => {
    expect(parseRange('10.10.1.19-10.10.1.2')).toBeNull();
    expect(parseRange('10.10.1.2-')).toBeNull();
    expect(parseRange('-10.10.1.2')).toBeNull();
    expect(parseRange('nope')).toBeNull();
  });

  it('formats, sizes and tests membership', () => {
    const r = parseRange('10.10.1.2-10.10.1.19')!;
    expect(formatRange(r)).toBe('10.10.1.2-10.10.1.19');
    expect(formatRange(parseRange('10.10.1.2')!)).toBe('10.10.1.2');
    expect(rangeSize(r)).toBe(18);
    expect(rangeContains(r, ip('10.10.1.2'))).toBe(true);
    expect(rangeContains(r, ip('10.10.1.19'))).toBe(true);
    expect(rangeContains(r, ip('10.10.1.20'))).toBe(false);
    expect(rangeOfSubnet(net('10.10.1.0/26'))).toEqual({ start: ip('10.10.1.0'), end: ip('10.10.1.63') });
  });

  it('merges touching and overlapping ranges', () => {
    const merged = mergeRanges([
      parseRange('10.0.0.10-10.0.0.20')!,
      parseRange('10.0.0.1-10.0.0.5')!,
      parseRange('10.0.0.6-10.0.0.8')!,
      parseRange('10.0.0.15-10.0.0.30')!,
      parseRange('10.0.0.12')!,
    ]);
    expect(merged.map(formatRange)).toEqual(['10.0.0.1-10.0.0.8', '10.0.0.10-10.0.0.30']);
  });

  it('subtracts holes from a range', () => {
    const base = parseRange('10.10.1.2-10.10.1.62')!;
    const left = subtractRanges(base, [
      parseRange('10.10.1.2-10.10.1.19')!,
      parseRange('10.10.1.30')!,
      parseRange('10.10.1.60-10.10.1.70')!,
      parseRange('10.10.0.1-10.10.0.9')!,
      parseRange('10.10.2.1')!,
    ]);
    expect(left.map(formatRange)).toEqual(['10.10.1.20-10.10.1.29', '10.10.1.31-10.10.1.59']);
    expect(subtractRanges(base, []).map(formatRange)).toEqual(['10.10.1.2-10.10.1.62']);
    expect(subtractRanges(base, [parseRange('10.10.1.0-10.10.1.255')!])).toEqual([]);
  });

  it('splits ranges into aligned CIDR blocks', () => {
    expect(nets(rangeToSubnets(parseRange('10.0.0.0-10.0.0.255')!))).toEqual(['10.0.0.0/24']);
    expect(nets(rangeToSubnets(parseRange('10.0.0.1-10.0.0.6')!))).toEqual([
      '10.0.0.1/32',
      '10.0.0.2/31',
      '10.0.0.4/31',
      '10.0.0.6/32',
    ]);
    expect(nets(rangeToSubnets(parseRange('10.0.0.64-10.0.1.255')!))).toEqual(['10.0.0.64/26', '10.0.0.128/25', '10.0.1.0/24']);
    expect(nets(rangeToSubnets(parseRange('0.0.0.0-255.255.255.255')!))).toEqual(['0.0.0.0/0']);
    expect(nets(rangeToSubnets(parseRange('255.255.255.255')!))).toEqual(['255.255.255.255/32']);
  });
});

describe('firstFit', () => {
  const pool = net('10.10.0.0/24');

  it('takes the lowest free block', () => {
    expect(formatSubnet(firstFit(pool, [], 26)!)).toBe('10.10.0.0/26');
    expect(formatSubnet(firstFit(pool, [net('10.10.0.0/26')], 26)!)).toBe('10.10.0.64/26');
  });

  it('skips past clashes and realigns', () => {
    expect(formatSubnet(firstFit(pool, [net('10.10.0.0/30')], 26)!)).toBe('10.10.0.64/26');
    expect(formatSubnet(firstFit(pool, [net('10.10.0.0/26'), net('10.10.0.64/27')], 27)!)).toBe('10.10.0.96/27');
    expect(formatSubnet(firstFit(pool, [net('10.10.0.0/25')], 30)!)).toBe('10.10.0.128/30');
  });

  it('respects reservations that are larger than the pool', () => {
    expect(firstFit(pool, [net('10.0.0.0/8')], 30)).toBeNull();
  });

  it('returns null when full or when the request cannot fit', () => {
    expect(firstFit(pool, [net('10.10.0.0/25'), net('10.10.0.128/25')], 30)).toBeNull();
    expect(firstFit(pool, [], 23)).toBeNull();
    expect(firstFit(pool, [], 33)).toBeNull();
    expect(formatSubnet(firstFit(pool, [], 24)!)).toBe('10.10.0.0/24');
  });

  it('works at the top of the address space', () => {
    const top = net('255.255.255.0/24');
    expect(formatSubnet(firstFit(top, [net('255.255.255.0/25')], 25)!)).toBe('255.255.255.128/25');
    expect(firstFit(top, [net('255.255.255.0/25'), net('255.255.255.128/25')], 25)).toBeNull();
  });
});

describe('allocateVlsm', () => {
  const pool = net('10.10.0.0/16');

  it('places the largest blocks first, ties by order', () => {
    const { allocated, failed } = allocateVlsm(
      pool,
      [],
      [
        { key: 'v99', prefix: 28, order: 99 },
        { key: 'v20', prefix: 26, order: 20 },
        { key: 'v10', prefix: 26, order: 10 },
      ],
    );
    expect(failed).toEqual([]);
    expect(formatSubnet(allocated.get('v10')!)).toBe('10.10.0.0/26');
    expect(formatSubnet(allocated.get('v20')!)).toBe('10.10.0.64/26');
    expect(formatSubnet(allocated.get('v99')!)).toBe('10.10.0.128/28');
  });

  it('is independent of the order requests are listed in', () => {
    const requests = [
      { key: 'a', prefix: 27, order: 30 },
      { key: 'b', prefix: 25, order: 40 },
      { key: 'c', prefix: 27, order: 10 },
      { key: 'd', prefix: 30, order: 5 },
    ];
    const forward = allocateVlsm(pool, [], requests).allocated;
    const backward = allocateVlsm(pool, [], [...requests].reverse()).allocated;
    expect([...forward].sort()).toEqual([...backward].sort());
    expect(formatSubnet(forward.get('b')!)).toBe('10.10.0.0/25');
    expect(formatSubnet(forward.get('c')!)).toBe('10.10.0.128/27');
    expect(formatSubnet(forward.get('a')!)).toBe('10.10.0.160/27');
    expect(formatSubnet(forward.get('d')!)).toBe('10.10.0.192/30');
  });

  it('breaks full ties by key', () => {
    const { allocated } = allocateVlsm(pool, [], [
      { key: 'z', prefix: 30, order: 1 },
      { key: 'a', prefix: 30, order: 1 },
      { key: 'a', prefix: 30, order: 1 },
    ]);
    expect(formatSubnet(allocated.get('z')!)).toBe('10.10.0.8/30');
  });

  it('allocates around reserved subnets', () => {
    const { allocated } = allocateVlsm(pool, [net('10.10.1.0/26'), net('10.10.0.0/30')], [
      { key: 'big', prefix: 24, order: 1 },
      { key: 'small', prefix: 30, order: 2 },
    ]);
    expect(formatSubnet(allocated.get('big')!)).toBe('10.10.2.0/24');
    expect(formatSubnet(allocated.get('small')!)).toBe('10.10.0.4/30');
  });

  it('reports requests that do not fit', () => {
    const small = net('192.168.0.0/29');
    const { allocated, failed } = allocateVlsm(small, [], [
      { key: 'one', prefix: 30, order: 1 },
      { key: 'two', prefix: 30, order: 2 },
      { key: 'three', prefix: 30, order: 3 },
      { key: 'huge', prefix: 24, order: 4 },
    ]);
    expect([...allocated.keys()].sort()).toEqual(['one', 'two']);
    expect(failed).toEqual(['huge', 'three']);
  });
});

describe('freeBlocks / usedAddressCount', () => {
  const pool = net('10.10.0.0/24');

  it('lists the free space as CIDR blocks', () => {
    expect(nets(freeBlocks(pool, []))).toEqual(['10.10.0.0/24']);
    expect(nets(freeBlocks(pool, [net('10.10.0.0/26'), net('10.10.0.64/28')]))).toEqual([
      '10.10.0.80/28',
      '10.10.0.96/27',
      '10.10.0.128/25',
    ]);
    expect(freeBlocks(pool, [net('10.0.0.0/8')])).toEqual([]);
  });

  it('ignores subnets outside the pool', () => {
    expect(nets(freeBlocks(pool, [net('172.16.0.0/24')]))).toEqual(['10.10.0.0/24']);
    expect(usedAddressCount(pool, [net('172.16.0.0/24')])).toBe(0);
  });

  it('counts overlapping usage once and clips to the pool', () => {
    expect(usedAddressCount(pool, [net('10.10.0.0/26'), net('10.10.0.0/27'), net('10.10.0.64/28')])).toBe(80);
    expect(usedAddressCount(pool, [net('10.10.0.0/16')])).toBe(256);
  });
});
