/** A path into the YAML document: object keys and array indexes. */
export type Path = (string | number)[];

export type Severity = 'error' | 'warning' | 'info';

/** One problem found in the file, pointing at a place in the YAML source. */
export interface Diagnostic {
  /** Stable machine-readable code, e.g. `OVERLAP` or `SCHEMA_REQUIRED`. */
  code: string;
  severity: Severity;
  message: string;
  /** Where in the document the problem is. */
  path: Path;
  /** 1-based line number in the YAML source. */
  line: number;
  /** Character offsets in the YAML source, for editor underlines. */
  from: number;
  to: number;
}

/** Severity of every semantic check (schema and syntax problems are always errors). */
export const SEVERITY = {
  REF_UNKNOWN: 'error',
  DUP_ID: 'error',
  VLAN_RANGE: 'error',
  NOT_NETWORK_ADDR: 'error',
  TOO_SMALL: 'error',
  OUTSIDE_SUPERNET: 'error',
  OVERLAP: 'error',
  ADDR_NOT_IN_SUBNET: 'error',
  ADDR_RESERVED: 'error',
  ADDR_DUP: 'error',
  ADDR_CONFLICT: 'error',
  STATIC_IN_POOL: 'error',
  ALLOC_FAILED: 'error',
  TUNNEL_PEER: 'error',
  TUNNEL_SUBNET: 'error',
  TUNNEL_PROTECTED_OVERLAP: 'error',
  DHCP_RELAY_UNREACHABLE: 'warning',
  TRUNK_VLAN_MISSING: 'warning',
  NETWORK_MISMATCH: 'warning',
  LOCKED_CHANGED: 'warning',
  ICON_REMOTE: 'warning',
} as const satisfies Record<string, Severity>;

export type SemanticCode = keyof typeof SEVERITY;

/** Callback used by the resolver and the checks to report a problem. */
export type Report = (code: SemanticCode, message: string, path: Path, severity?: Severity) => void;

export function countBySeverity(diagnostics: Diagnostic[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return counts;
}
