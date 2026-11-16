/**
 * "Copy resolved YAML": writes every auto value back into the document so the
 * plan no longer moves when something else changes. Comments and formatting of
 * the original text are kept.
 */
import { parseDocument } from 'yaml';
import { formatIp, formatRange, formatSubnet, rangeContains } from '../ip';
import type { ResolvedModel } from './resolve';

export function freezeYaml(text: string, model: ResolvedModel): string {
  const doc = parseDocument(text);

  for (const site of model.sites) {
    for (const vlan of site.vlans) {
      if (vlan.subnet?.auto) doc.setIn([...vlan.path, 'subnet'], formatSubnet(vlan.subnet.value));
      if (vlan.gateway?.auto) doc.setIn([...vlan.path, 'gateway'], formatIp(vlan.gateway.value));
      const dhcp = vlan.dhcp;
      if (dhcp?.pool?.auto) {
        const { start, end } = dhcp.pool.value;
        doc.setIn([...vlan.path, 'dhcp', 'pool'], doc.createNode({ start: formatIp(start), end: formatIp(end) }, { flow: true }));
        // An explicit pool may not contain statics, so the ones the auto pool
        // stepped around become explicit excludes.
        const inside = vlan.statics
          .filter((s) => rangeContains(dhcp.pool!.value, s.ip) && !dhcp.exclude.some((r) => rangeContains(r, s.ip)))
          .map((s) => formatIp(s.ip));
        if (inside.length) {
          const exclude = [...dhcp.exclude.map(formatRange), ...inside];
          doc.setIn([...vlan.path, 'dhcp', 'exclude'], doc.createNode(exclude, { flow: true }));
        }
      }
    }
  }

  for (const device of model.devices.values()) {
    (device.raw.interfaces ?? []).forEach((iface, index) => {
      if (iface.subinterfaces !== 'auto') return;
      const subs = device.interfaces
        .filter((i) => i.parent === iface.name && i.vlan !== undefined)
        .map((i) => {
          const sub: { vlan: number; address?: string } = { vlan: i.vlan! };
          if (i.address) sub.address = `${formatIp(i.address.value.ip)}/${i.address.value.prefix}`;
          return doc.createNode(sub, { flow: true });
        });
      doc.setIn([...device.path, 'interfaces', index, 'subinterfaces'], doc.createNode(subs));
    });
  }

  for (const link of model.links) {
    if (link.subnet?.auto) doc.setIn([...link.path, 'subnet'], formatSubnet(link.subnet.value));
    for (const side of ['a', 'b'] as const) {
      const address = link[side].address;
      if (address?.auto) doc.setIn([...link[side].path, 'address'], formatIp(address.value));
    }
  }

  for (const tunnel of model.tunnels) {
    for (const side of ['a', 'b'] as const) {
      const end = tunnel[side];
      if (end.address?.auto) doc.setIn([...end.path, 'address'], formatIp(end.address.value));
      if (end.protected.auto) {
        doc.setIn([...tunnel.path, 'protected', side], doc.createNode(end.protected.value.map(formatSubnet), { flow: true }));
      }
    }
  }

  return doc.toString({ lineWidth: 0 });
}
