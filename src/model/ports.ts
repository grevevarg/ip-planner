/** A switch-port range such as `f0/1-10`: ports `f0/1` … `f0/10`. */
export interface PortRange {
  /** Everything before the last number, e.g. `f0/`. */
  prefix: string;
  start: number;
  end: number;
}

const RANGE = /^(.*?)(\d+)(?:-(\d+))?$/;

/** Parses `g0/1` or `f0/1-10`. Null when malformed or when the range runs backwards. */
export function parsePortRange(text: string): PortRange | null {
  const match = RANGE.exec(text);
  if (!match) return null;
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  if (end < start) return null;
  return { prefix: match[1], start, end };
}

/** True when the single port `name` (e.g. `f0/7`) is part of the range. */
export function rangeCoversPort(range: PortRange, name: string): boolean {
  const single = parsePortRange(name);
  if (!single || single.start !== single.end) return false;
  return single.prefix === range.prefix && single.start >= range.start && single.start <= range.end;
}

export function portCount(range: PortRange): number {
  return range.end - range.start + 1;
}
