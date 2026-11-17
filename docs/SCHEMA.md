# netplan YAML schema (version 1)

> **Generated file.** Produced from `src/model/schema.json` by `scripts/gen-schema-docs.ts`.
> Do not edit it by hand; change the schema and run `npm run gen:docs`.

## Conventions

- **Ids.** Every object has a stable `id` (a lowercase slug) that other parts of the file refer to. `name` is only display text.
- **References.** An interface is referred to as `device-id:interface-name`, for example `hanabata-r1:f0/0`.
- **Addresses.** CIDR notation is used wherever a prefix makes sense (`10.10.1.1/26`).
- **Auto values.** Most derived values are optional. When you leave one out the app computes it and marks it *auto* in the plan. "Copy resolved YAML" writes all auto values into the file so you can freeze them.
- **Locked.** Objects marked `locked: true` are shown with a lock badge. If `locked_baseline` holds the values you were given, any difference is reported as `LOCKED_CHANGED`.
- **No secrets.** Never put pre-shared keys in the file. `crypto.psk_ref` is free text such as "given by teacher".
- **Unknown fields are errors.** Every object rejects properties that are not listed here, so typos are caught.

## Contents

- [Top level](#top-level)
- [Meta](#meta)
- [Diagram](#diagram)
- [ExternalGroup](#externalgroup)
- [Site](#site)
- [Wan](#wan)
- [Vlan](#vlan)
- [Lan](#lan)
- [Dhcp](#dhcp)
- [Pool](#pool)
- [StaticEntry](#staticentry)
- [Device](#device)
- [Interface](#interface)
- [Subinterface](#subinterface)
- [Port](#port)
- [Link](#link)
- [LinkEnd](#linkend)
- [Tunnel](#tunnel)
- [TunnelEnd](#tunnelend)
- [ProtectedNetworks](#protectednetworks)
- [Crypto](#crypto)
- [Value types](#value-types)
- [Full example](#full-example)

## Top level

One YAML file describing a lab network: sites, VLANs, subnets, devices, interfaces, point-to-point links and VPN tunnels. The plan tables and the topology diagram are both generated from it.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `version` | `1` | yes |  | Schema version of the file. Must be 1. |
| `meta` | [Meta](#meta) | no |  | Title block shown on the cover of the plan and in the page footer of the PDF. |
| `diagram` | [Diagram](#diagram) | no |  | Settings for the generated D2 topology diagram. |
| `transit_pool` | [CIDR](#cidr) | no |  | Address block that point-to-point links without their own `subnet` are auto-allocated from (a /30 each, or a /31 when the link sets `p2p: true`). Leave it out if every link has an explicit subnet.<br>Example: `10.255.0.0/24` |
| `external` | [ExternalGroup](#externalgroup)[] | no |  | Networks you connect to but do not own, for example the ISP. Their devices appear in the topology and their addresses take part in overlap and duplicate checks. |
| `sites` | [Site](#site)[] | no |  | The sites (companies, offices, labs) you are planning. Each site gets its own section in the plan and its own container in the topology. |
| `links` | [Link](#link)[] | no |  | Point-to-point links between two device interfaces that are neither a site WAN connection nor a VLAN, for example a leased line or a cable between two routers. |
| `tunnels` | [Tunnel](#tunnel)[] | no |  | VPN tunnels between two devices. Drawn dashed in the topology and listed in the VPN section of the plan. |
| `locked_baseline` | map of object | no |  | The values you were given for locked objects, keyed by the object's id (for a VLAN use `<site-id>:<vlan-id>`, e.g. `braintech:10`; a LAN uses its own id). Each value is a copy of the object exactly as it was handed out. When an object marked `locked: true` no longer matches its baseline, the app reports `LOCKED_CHANGED`. The `locked` flag itself is ignored in the comparison.<br>Example: `{"isp":{"id":"isp","name":"ISP","devices":[]}}` |

## Meta

Document information shown on the cover of the plan.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `title` | string | no |  | Title of the plan. Also used in the PDF footer and as the suggested file name when saving.<br>Example: `Example – Braintech / Kokonoe Group / Hanabata Cookies` |
| `authors` | string[] | no |  | People who wrote the plan.<br>Example: `["ntsu"]` |
| `date` | string (date) | no |  | Date of the plan in ISO format (YYYY-MM-DD).<br>Example: `2026-11-16` |
| `notes` | string | no |  | Free text shown on the cover, for example assumptions or constraints given in the assignment. |

## Diagram

Settings for the generated D2 topology diagram.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `layout` | `dagre` \| `elk` | no | `dagre` | Layout engine that positions the nodes.<br>• `dagre`: Fast layered layout. Good for small and medium diagrams.<br>• `elk`: Eclipse Layout Kernel. Slower, but usually routes connections more cleanly when containers are nested. |
| `direction` | `up` \| `down` \| `left` \| `right` | no | `down` | Direction the diagram flows in.<br>• `up`: Bottom to top.<br>• `down`: Top to bottom.<br>• `left`: Right to left.<br>• `right`: Left to right. |
| `theme` | `default` \| `dark` \| `sketch` | no | `default` | Visual theme of the diagram. Printing always uses the diagram as rendered on screen.<br>• `default`: Light background with neutral colours.<br>• `dark`: Dark background.<br>• `sketch`: Hand-drawn look on a light background. |
| `extra_d2` | string | no |  | Raw D2 source appended verbatim after the generated diagram. Use it to add notes or override styles without changing the generator.<br>Example: `legend: "Dashed = VPN"` |

## ExternalGroup

A group of devices you connect to but do not own, such as an ISP. Drawn as a container with a red dashed border.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the group. Must be unique among all sites, LANs, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id. |
| `locked` | boolean | no | `false` | Marks the group as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text shown next to the group in the plan. |
| `devices` | [Device](#device)[] | no |  | Devices that belong to the group. |

Example:

```yaml
id: isp
name: ISP
locked: true
devices:
  - id: isp-r1
    type: router
    interfaces:
      - name: f0/1
        address: 203.0.113.1/28
```

## Site

One site: an address block, its VLANs and its devices.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the site. Must be unique among all sites, LANs, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id. |
| `supernet` | [CIDR](#cidr) | yes |  | Address block that every VLAN and LAN subnet of the site must fit inside. VLANs and LANs without a `subnet` are auto-allocated from it. |
| `color` | string | no |  | Colour of the site's header band in the plan and of its container in the topology, as a six-digit hex colour.<br>Example: `#16a34a` |
| `wan` | [Wan](#wan) \| [Wan](#wan)[] | no |  | The site's connection to the outside world: one uplink, or a list of uplinks when the site has redundant connections.<br>• [Wan](#wan): A single uplink.<br>• [Wan](#wan)[]: Several uplinks, for example to two providers. Each needs its own interface. |
| `vlans` | [Vlan](#vlan)[] | no |  | VLANs of the site. VLAN ids must be unique within the site. |
| `lans` | [Lan](#lan)[] | no |  | Untagged networks that sit directly on a router interface, without a VLAN or a sub-interface. VLANs without a `subnet` and LANs without a `subnet` are auto-allocated from the supernet together. |
| `devices` | [Device](#device)[] | no |  | Devices located at the site. |
| `locked` | boolean | no | `false` | Marks the site as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text shown under the site heading in the plan. |

## Wan

A site's uplink: which interface faces the provider, its address and the next hop.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | no |  | Display name of the uplink, such as the provider or the circuit. Shown in the WAN table and on the connection in the topology.<br>Example: `Primary` |
| `device` | [Slug](#slug) | yes |  | Id of the device that holds the WAN interface. Must be a device of this site. |
| `interface` | string | yes |  | Name of the WAN interface on that device. The interface must be listed under the device's `interfaces`.<br>Example: `f0/0` |
| `address` | [CIDR](#cidr) | no |  | Address and prefix of the WAN interface. May be given on the interface itself instead; if both are given they must be equal.<br>Example: `203.0.113.14/28` |
| `gateway` | [IPv4 address](#ipv4-address) | no |  | Next-hop address of the provider. Must be inside the WAN subnet. If another device has an interface with this address, the topology draws the WAN connection to it.<br>Example: `203.0.113.1` |
| `nat` | boolean | no | `false` | Whether the site's private addresses are translated (NAT/PAT) on this interface. |

## Vlan

A VLAN and its subnet. Give either `hosts` (the subnet is then auto-allocated inside the site supernet) or an explicit `subnet`, or both.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | integer | yes |  | VLAN id, 1–4094. Ids 1002–1005 are reserved on Cisco equipment and are rejected. Must be unique within the site.<br>Example: `10` |
| `name` | string | no |  | Name of the VLAN.<br>Example: `Research` |
| `hosts` | integer | no |  | Number of host addresses needed, including the gateway. Decides the size of an auto-allocated subnet and is checked against the size of an explicit one.<br>Example: `40` |
| `growth_percent` | number | no | `0` | Extra headroom added to `hosts` when sizing an auto-allocated subnet, in percent (rounded up to whole hosts).<br>Example: `25` |
| `subnet` | [CIDR](#cidr) | no |  | Subnet of the VLAN. Must be a network address inside the site supernet. If omitted, the smallest subnet that fits `hosts` is auto-allocated (largest VLANs first, then by VLAN id). |
| `gateway` | [Address](#address) | no |  | Default gateway of the VLAN. Defaults to the first usable address of the subnet. |
| `dhcp` | [Dhcp](#dhcp) | no |  | How hosts in the VLAN get their addresses. Omit for VLANs that are addressed statically only. |
| `native` | boolean | no | `false` | Whether this VLAN is the native (untagged) VLAN on trunks. |
| `static` | [StaticEntry](#staticentry)[] | no |  | Addresses in the VLAN that are assigned by hand, such as servers, printers and switch management addresses. |
| `notes` | string | no |  | Free text shown in the Notes column of the VLAN table. |
| `locked` | boolean | no | `false` | Marks the VLAN as given and not to be changed. Its baseline key in `locked_baseline` is `<site-id>:<vlan-id>`. |

Example:

```yaml
id: 10
name: Research
hosts: 40
dhcp:
  mode: server
  on: braintech-r1
```

## Lan

An untagged network on one router interface, with no VLAN tag and no sub-interface. The interface gets the LAN's gateway as its address. Give either `hosts` (the subnet is then auto-allocated inside the site supernet) or an explicit `subnet`, or both.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the LAN. Must be unique among all sites, LANs, external groups, devices, links and tunnels. Interfaces of hosts in the LAN refer to it with `lan`. |
| `name` | string | no |  | Display name. Defaults to the id.<br>Example: `Office` |
| `device` | [Slug](#slug) | yes |  | Id of the router (or layer 3 switch) the LAN is attached to. Must be a device of this site. |
| `interface` | string | yes |  | Name of the interface on that device that the LAN is plugged into. The interface must be listed under the device's `interfaces` and gets the LAN gateway as its address. If the interface already has an `address`, it is used as the gateway and its network as the subnet.<br>Example: `f1/1` |
| `hosts` | integer | no |  | Number of host addresses needed, including the gateway. Decides the size of an auto-allocated subnet and is checked against the size of an explicit one.<br>Example: `15` |
| `growth_percent` | number | no | `0` | Extra headroom added to `hosts` when sizing an auto-allocated subnet, in percent (rounded up to whole hosts).<br>Example: `25` |
| `subnet` | [CIDR](#cidr) | no |  | Subnet of the LAN. Must be a network address inside the site supernet. If omitted, it is taken from the interface's `address`, or else the smallest subnet that fits `hosts` is auto-allocated. |
| `gateway` | [Address](#address) | no |  | Address of the router interface, which is the hosts' default gateway. Defaults to the interface's `address`, or else to the first usable address of the subnet. |
| `dhcp` | [Dhcp](#dhcp) | no |  | How hosts in the LAN get their addresses. Omit for LANs that are addressed statically only. |
| `static` | [StaticEntry](#staticentry)[] | no |  | Addresses in the LAN that are assigned by hand, such as servers and printers. |
| `notes` | string | no |  | Free text shown in the Notes column of the LAN table. |
| `locked` | boolean | no | `false` | Marks the LAN as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |

Example:

```yaml
id: hanabata-office
name: Office
device: hanabata-r1
interface: f2/0
hosts: 12
static:
  - name: printer
    ip: 10.30.10.5
    role: label printer
```

## Dhcp

DHCP settings of a VLAN or LAN.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | `server` \| `relay` \| `none` | yes |  | Where DHCP leases for the VLAN or LAN come from.<br>• `server`: A device of the site runs the DHCP pool itself; name it with `on`.<br>• `relay`: The gateway forwards DHCP requests to the server given in `server` (ip helper-address).<br>• `none`: No DHCP in this network; all hosts are static. |
| `on` | [Slug](#slug) | no |  | Id of the device that runs the DHCP pool. Used with `mode: server`. |
| `server` | [IPv4 address](#ipv4-address) | no |  | Address of the DHCP server. With `mode: relay` it is where requests are relayed to, and a warning is shown if it is not inside any subnet of the same site. With `mode: server` it is optional and names a server that sits in this VLAN or LAN, so it must be inside its subnet. |
| `pool` | [Pool](#pool) | no |  | Range of addresses handed out. Defaults to the address after the gateway up to the last usable address. |
| `exclude` | string[] | no |  | Addresses or ranges inside the pool that must not be handed out. Each entry is a single address or `first-last`.<br>Example: `["10.10.1.2-10.10.1.19","10.10.1.50"]` |

## Pool

An inclusive range of addresses handed out by DHCP.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `start` | [IPv4 address](#ipv4-address) | yes |  | First address of the pool. |
| `end` | [IPv4 address](#ipv4-address) | yes |  | Last address of the pool. |

## StaticEntry

One hand-assigned address in a VLAN or LAN.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | What the address belongs to. If it equals the id or name of a device that has the same address on an interface, the two are treated as the same assignment rather than a duplicate.<br>Example: `dhcp01` |
| `ip` | [IPv4 address](#ipv4-address) | yes |  | The assigned address. Must be a host address inside the subnet of its VLAN or LAN and outside the DHCP pool. |
| `role` | string | no |  | Free text describing what the host does.<br>Example: `DHCP server` |

## Device

A network device or host. Routers and hosts list `interfaces`; switches list `ports` (and may also have interfaces, for example a management SVI).

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the device. Must be unique among all sites, LANs, external groups, devices, links and tunnels. Used in references such as `braintech-r1:f0/0`. |
| `name` | string | no |  | Display name (for example the hostname). Defaults to the id. |
| `type` | `router` \| `switch` \| `l3switch` \| `firewall` \| `ap` \| `server` \| `pc` \| `cloud` \| `isp` | yes |  | Kind of device. Decides the default icon in the topology.<br>• `router`: Router.<br>• `switch`: Layer 2 switch.<br>• `l3switch`: Multilayer (layer 3) switch.<br>• `firewall`: Firewall.<br>• `ap`: Wireless access point.<br>• `server`: Server.<br>• `pc`: Workstation or other end host.<br>• `cloud`: A cloud node standing for a network you do not model in detail, such as the internet. Other interfaces can link to it by its id.<br>• `isp`: A provider node, when the ISP is drawn as a single box rather than a router. |
| `icon` | string | no |  | Icon used in the topology. A built-in icon name (`router`), a path relative to the site root (`icons/custom/fw.svg`), or an absolute `https://` URL (passed through as-is; may not print). Defaults to the device type.<br>Example: `l3switch`, `icons/custom/fw.svg` |
| `interfaces` | [Interface](#interface)[] | no |  | Routed interfaces of the device. Interface names must be unique within the device. |
| `ports` | [Port](#port)[] | no |  | Switch ports of the device, given as ranges that share the same configuration. |
| `vlan` | integer | no |  | For a device that is not configured per port, such as an unmanaged switch or an access point: the VLAN (of the device's site) that all its ports are in. If omitted on a device without `ports` or `interfaces`, it is inferred from what the device is cabled to (an access port, or another unmanaged device). A device sits in a VLAN or a LAN, not both.<br>Example: `10` |
| `lan` | [Slug](#slug) | no |  | Like `vlan`, but for a LAN of the device's site: an unmanaged switch plugged into the LAN's router interface. Inferred from the cabling when omitted, like `vlan`. |
| `uplink` | [LinkTarget](#linktarget) | no |  | What the device is cabled to, for a device whose interfaces are not listed, such as an unmanaged switch. `device-id:port` for a switch port or router interface, or just `device-id` for another unmanaged device. Draws a connection in the topology. Hosts can also link to the device by its id.<br>Example: `kokonoe-sw1:f0/1` |
| `locked` | boolean | no | `false` | Marks the device as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text about the device. |

## Interface

A routed interface. Its address may be written here, or come from the site `wan`, from a LAN it is the gateway of, from a `links` entry that names it as an endpoint, or from its sub-interfaces.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | Interface name as used on the device, without spaces.<br>Example: `f0/0`, `g0/0/1`, `vlan99` |
| `address` | [CIDR](#cidr) | no |  | Address and prefix of the interface. Omit it for interfaces whose address comes from the site `wan`, a LAN or a link. |
| `role` | `wan` \| `lan` \| `trunk` \| `p2p` \| `mgmt` \| `loopback` | no |  | What the interface is used for. Shown in the interface table.<br>• `wan`: Faces the provider. A valid underlay for tunnels.<br>• `lan`: Routed interface in a single LAN or VLAN.<br>• `trunk`: Carries several VLANs, normally with sub-interfaces (router-on-a-stick).<br>• `p2p`: End of a point-to-point link.<br>• `mgmt`: Management interface, such as a switch SVI.<br>• `loopback`: Loopback interface. |
| `vlan` | integer | no |  | VLAN id (of the device's site) that this interface sits in, for example a switch SVI or a server NIC. The address must then be inside that VLAN's subnet. |
| `lan` | [Slug](#slug) | no |  | Id of the LAN (of the device's site) that this interface sits in, for example a server NIC. The address must then be inside that LAN's subnet. Not needed on the router interface the LAN itself names. An interface sits in a VLAN or a LAN, not both. |
| `link` | [LinkTarget](#linktarget) | no |  | What the interface is cabled to. Draws a connection in the topology. |
| `subinterfaces` | `auto` \| [Subinterface](#subinterface)[] | no |  | 802.1Q sub-interfaces. `auto` creates one `<name>.<vlan>` sub-interface per VLAN of the site, each with the VLAN's gateway address. A list creates only the ones named.<br>• `auto`: One sub-interface per VLAN of the site, addressed with the VLAN gateway.<br>• [Subinterface](#subinterface)[]: Explicit list of sub-interfaces.<br>Example: `auto` |
| `description` | string | no |  | Free text shown in the interface table. |

## Subinterface

One 802.1Q sub-interface, named `<interface>.<vlan>`.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `vlan` | integer | yes |  | VLAN id (of the device's site) carried by the sub-interface. |
| `address` | [CIDR](#cidr) | no |  | Address of the sub-interface. Defaults to the VLAN's gateway. |

## Port

One switch port or a range of ports with the same configuration.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `range` | string | yes |  | A single port (`g0/1`) or a range over the last number (`f0/1-10`).<br>Example: `g0/1`, `f0/1-10` |
| `mode` | `access` \| `trunk` | yes |  | Switchport mode.<br>• `access`: Untagged port in one VLAN, given by `vlan`.<br>• `trunk`: Tagged port carrying the VLANs in `allowed` (all VLANs of the site if omitted). |
| `vlan` | integer | no |  | Access VLAN id. Used with `mode: access`. |
| `allowed` | integer[] | no |  | VLAN ids allowed on the trunk. Used with `mode: trunk`. Defaults to all VLANs of the site.<br>Example: `[10,20,99]` |
| `link` | [LinkTarget](#linktarget) | no |  | What the port is cabled to. Only meaningful for a single port, not a range. Draws a connection in the topology. |
| `description` | string | no |  | Free text shown in the switchport table. |

## Link

A point-to-point link between two interfaces with its own small subnet.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the link. Must be unique among all sites, LANs, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id.<br>Example: `Buried cable` |
| `subnet` | [CIDR](#cidr) | no |  | Subnet of the link. If omitted, it is auto-allocated from the top-level `transit_pool`.<br>Example: `10.255.0.0/30` |
| `p2p` | boolean | no | `false` | Allow a /31 subnet (RFC 3021), which has two usable addresses and no network or broadcast address. Without it a /31 is rejected. |
| `a` | [LinkEnd](#linkend) | yes |  | First end of the link. Gets the first usable address unless `address` is given. |
| `b` | [LinkEnd](#linkend) | yes |  | Second end of the link. Gets the second usable address unless `address` is given. |
| `locked` | boolean | no | `false` | Marks the link as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text about the link. |

## LinkEnd

One end of a point-to-point link.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `endpoint` | string | yes |  | The interface at this end, as `device-id:interface-name`. The interface must be listed under the device's `interfaces`.<br>Example: `kokonoe-r1:f0/2` |
| `address` | [Address](#address) | no |  | Address of this end. Defaults to the first (side a) or second (side b) usable address of the link subnet. |

## Tunnel

A VPN tunnel between two devices. Never put keys in the file: `crypto.psk_ref` is a free-text pointer to where the key comes from.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the tunnel. Must be unique among all sites, LANs, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id.<br>Example: `VPN Braintech – Hanabata` |
| `type` | `ipsec-policy` \| `ipsec-vti` \| `gre` \| `gre-ipsec` \| `wireguard` | yes |  | Tunnel technology. Decides whether the tunnel has its own subnet.<br>• `ipsec-policy`: Policy-based IPsec (crypto map). No tunnel interface, so `subnet` is not allowed; traffic is selected by the `protected` networks.<br>• `ipsec-vti`: Route-based IPsec with a virtual tunnel interface. Requires `subnet`.<br>• `gre`: Plain GRE without encryption. Requires `subnet`.<br>• `gre-ipsec`: GRE protected by IPsec. Requires `subnet`.<br>• `wireguard`: WireGuard. Requires `subnet`. |
| `a` | [TunnelEnd](#tunnelend) | yes |  | First end of the tunnel. Gets the first usable address of `subnet` unless `address` is given. |
| `b` | [TunnelEnd](#tunnelend) | yes |  | Second end of the tunnel. Gets the second usable address of `subnet` unless `address` is given. |
| `subnet` | [CIDR](#cidr) | no |  | Subnet of the tunnel interfaces. Required for every type except `ipsec-policy`, where it is forbidden. Must not overlap any other subnet in the file.<br>Example: `10.255.255.0/30` |
| `p2p` | boolean | no | `false` | Allow a /31 tunnel subnet (RFC 3021). |
| `protected` | [ProtectedNetworks](#protectednetworks) | no |  | Networks behind each end that are reachable through the tunnel. Defaults to `auto` on both sides. |
| `routing` | `static` \| `ospf` \| `eigrp` \| `bgp` | no | `static` | How routes to the protected networks are learned.<br>• `static`: Static routes pointing at the tunnel.<br>• `ospf`: OSPF runs over the tunnel.<br>• `eigrp`: EIGRP runs over the tunnel.<br>• `bgp`: BGP runs over the tunnel. |
| `crypto` | [Crypto](#crypto) | no |  | Encryption parameters. Not used by plain `gre`. |
| `locked` | boolean | no | `false` | Marks the tunnel as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text about the tunnel. |

## TunnelEnd

One end of a tunnel.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `device` | [Slug](#slug) | yes |  | Id of the device that terminates the tunnel. |
| `underlay` | string | yes |  | Name of the interface on that device the tunnel is sourced from. Its address is the peer address the other side connects to, so it needs an address and should be a WAN or link interface.<br>Example: `f0/0` |
| `address` | [Address](#address) | no |  | Address of the tunnel interface at this end. Defaults to the first (side a) or second (side b) usable address of the tunnel subnet. |

## ProtectedNetworks

The networks behind each end of a tunnel. The two sides must not overlap.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `a` | [ProtectedSide](#protectedside) | no | `auto` | Networks behind side a. |
| `b` | [ProtectedSide](#protectedside) | no | `auto` | Networks behind side b. |

## Crypto

Encryption parameters of a tunnel. Documentation only; nothing is generated from them. Secrets do not belong here.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `ike` | `1` \| `2` | no |  | IKE version.<br>• `1`: IKEv1 (ISAKMP).<br>• `2`: IKEv2. |
| `encryption` | string | no |  | Encryption algorithm, as free text.<br>Example: `aes-256`, `aes-256-gcm`, `chacha20-poly1305` |
| `integrity` | string | no |  | Integrity (hash) algorithm, as free text.<br>Example: `sha256`, `sha384` |
| `dh_group` | integer | no |  | Diffie-Hellman group number.<br>Example: `14` |
| `lifetime_s` | integer | no |  | Lifetime of the security association in seconds.<br>Example: `86400` |
| `psk_ref` | string | no |  | Where the pre-shared key comes from, as free text. Never the key itself.<br>Example: `given by teacher` |

## Value types

Formats used by the fields above.

### Slug

A stable identifier: lowercase letters, digits and hyphens, starting with a letter or digit. Used to refer to the object from elsewhere in the file.

Pattern: `^[a-z0-9][a-z0-9-]*$`

Examples: `braintech-r1`

### IPv4 address

An IPv4 address in dotted-quad notation, without a prefix length.

Examples: `10.10.1.1`

### CIDR

An IPv4 address with a prefix length. For a subnet the address must be the network address; for an interface it is the interface's own address.

Pattern: `^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}/(3[0-2]|[12]?\d)$`

Examples: `10.10.1.0/26`

### Address

An IPv4 address, optionally followed by a prefix length. When the prefix is given it must match the subnet the address lives in.

Pattern: `^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(/(3[0-2]|[12]?\d))?$`

Examples: `10.10.1.1`, `10.10.1.1/26`

### LinkTarget

A reference to the other end of a cable: `device-id:interface-name` (an interface or switch port of that device), or just `device-id` for nodes without interfaces such as a cloud.

Pattern: `^[a-z0-9][a-z0-9-]*(:\S+)?$`

Examples: `braintech-r1:f0/1`, `internet`

### ProtectedSide

Either `auto` or an explicit list of networks.

- `auto`: All VLAN and LAN subnets of the site the tunnel device belongs to.
- [CIDR](#cidr)[]: Explicit list of networks in CIDR notation.

Examples: `auto`, `["10.10.1.0/26"]`

## Full example

This is `public/examples/three-companies.yaml`, which is also available under **Load example** in the app. All values are illustrative.

```yaml
# Example: three companies connected through one ISP.
#
# ILLUSTRATIVE VALUES ONLY. The companies, departments and addresses are made
# up (the public addresses are from the documentation ranges in RFC 5737). Use
# it as a reference: each site shows a different way to build a network, so
# copy the site that is closest to yours and change the names and numbers.
#
#   Braintech         router-on-a-stick to a managed layer 3 switch,
#                     DHCP relay and a management VLAN
#   Kokonoe Group     two WAN uplinks, VLANs with one unmanaged switch each
#   Hanabata Cookies  no VLANs: untagged LANs straight on router ports,
#                     one unmanaged switch per LAN

version: 1
meta:
  title: "Example – Braintech / Kokonoe Group / Hanabata Cookies"
  authors: ["ntsu"]
  date: 2026-11-16
  notes: |
    The ISP may not be changed (it is locked, see locked_baseline at the end).
    All values in this example are illustrative.

diagram:
  layout: dagre          # dagre | elk
  direction: right       # up | down | left | right (right fits a landscape page best)
  theme: default         # default | dark | sketch

external:                # things you connect to but don't own
  - id: isp
    name: ISP
    locked: true
    devices:
      - id: isp-r1
        name: ISP
        type: router
        interfaces:
          - { name: f0/0, address: 203.0.113.1/28 }     # Braintech
          - { name: f0/1, address: 198.51.100.1/28 }    # Kokonoe Group, primary
          - { name: f0/2, address: 198.51.100.17/30 }   # Kokonoe Group, backup
          - { name: f1/0, address: 192.0.2.1/30 }       # Hanabata Cookies
          - { name: f2/0, link: internet }              # cable to a cloud node with no address
      - id: internet
        name: Internet
        type: cloud

sites:
  # ── Braintech: router-on-a-stick to a managed layer 3 switch ──────────────
  - id: braintech
    name: Braintech
    supernet: 10.10.0.0/16
    color: "#16a34a"
    wan:
      device: braintech-r1
      interface: f0/0
      address: 203.0.113.14/28
      gateway: 203.0.113.1
      nat: true
    vlans:
      - id: 10
        name: Research
        hosts: 40
        # subnet omitted → auto-allocated (VLSM) inside the supernet
        dhcp: { mode: server, on: braintech-r1 }
      - id: 20
        name: Lab
        hosts: 60
        subnet: 10.10.1.0/26
        gateway: 10.10.1.1/26          # default: first usable
        dhcp:
          mode: relay                  # the router forwards to dhcp01 (ip helper-address)
          server: 10.10.99.10
          pool: { start: 10.10.1.20, end: 10.10.1.62 }
          exclude: [10.10.1.2-10.10.1.19]
      - id: 99
        name: Management
        hosts: 10
        subnet: 10.10.99.0/28
        native: false
        static:
          - { name: BT-Core, ip: 10.10.99.2, role: switch management }
          - { name: dhcp01, ip: 10.10.99.10, role: DHCP server }
    devices:
      - id: braintech-r1
        name: BT-R1
        type: router
        interfaces:
          - { name: f0/0, role: wan }
          - name: f0/1
            role: trunk
            subinterfaces: auto        # one .<vlan> sub-interface per VLAN, address = VLAN gateway
      - id: braintech-sw1
        name: BT-Core
        type: l3switch
        icon: l3switch                 # optional; defaults to the type
        ports:
          - { range: "g0/1", mode: trunk, allowed: [10, 20, 99], link: braintech-r1:f0/1 }
          - { range: "f0/1-10", mode: access, vlan: 10 }
          - { range: "f0/11-20", mode: access, vlan: 20 }
          - { range: "f0/24", mode: access, vlan: 99 }
      - id: braintech-dhcp01
        name: dhcp01
        type: server
        interfaces:
          - { name: eth0, vlan: 99, address: 10.10.99.10/28, link: braintech-sw1:f0/24 }

  # ── Kokonoe Group: redundant uplinks, one unmanaged switch per VLAN ───────
  - id: kokonoe
    name: Kokonoe Group
    supernet: 10.20.0.0/16
    color: "#7c3aed"
    wan:                               # one uplink, or a list of them for redundancy
      - name: Primary
        device: kokonoe-r1
        interface: f0/0
        address: 198.51.100.14/28
        gateway: 198.51.100.1
        nat: true
      - name: Backup
        device: kokonoe-r1
        interface: f0/1
        address: 198.51.100.18/30
        gateway: 198.51.100.17
        nat: true
    vlans:
      - id: 10
        name: Finance
        hosts: 25
        growth_percent: 20             # sized for 30 hosts
        dhcp: { mode: server, on: kokonoe-r1 }
      - id: 20
        name: Investments
        hosts: 30
        dhcp: { mode: server, on: kokonoe-r1 }
      - id: 30
        name: Legal
        hosts: 12
        dhcp: { mode: server, on: kokonoe-r1 }
    devices:
      - id: kokonoe-r1
        name: KG-R1
        type: router
        interfaces:
          - { name: f0/0, role: wan }
          - { name: f0/1, role: wan }
          - { name: f0/2, role: p2p }
          - { name: f1/0, role: trunk, subinterfaces: auto }
      - id: kokonoe-sw1
        name: KG-SW1
        type: switch
        ports:
          - { range: "g0/1", mode: trunk, link: kokonoe-r1:f1/0 }   # allowed omitted → all VLANs
          - { range: "f0/1", mode: access, vlan: 10 }
          - { range: "f0/2", mode: access, vlan: 20 }
          - { range: "f0/3", mode: access, vlan: 30 }
      # Unmanaged switches have no ports to configure. `uplink` says where they
      # are plugged in, and their VLAN follows from that access port.
      - { id: kokonoe-sw-finance, name: Finance switch, type: switch, uplink: kokonoe-sw1:f0/1 }
      - { id: kokonoe-sw-investments, name: Investments switch, type: switch, uplink: kokonoe-sw1:f0/2 }
      - { id: kokonoe-sw-legal, name: Legal switch, type: switch, vlan: 30, uplink: kokonoe-sw1:f0/3 }   # vlan written out: checked against the port

  # ── Hanabata Cookies: untagged LANs on router ports, no VLANs ─────────────
  - id: hanabata
    name: Hanabata Cookies
    supernet: 10.30.0.0/16
    color: "#db2777"
    wan: { device: hanabata-r1, interface: f0/0, address: 192.0.2.2/30, gateway: 192.0.2.1, nat: true }
    lans:                     # each LAN gets its own router port: no VLAN, no sub-interface
      - id: hanabata-kitchen
        name: Kitchen
        device: hanabata-r1
        interface: f1/0       # gets the LAN gateway as its address
        hosts: 20
        dhcp: { mode: server, on: hanabata-r1 }
      - id: hanabata-shop
        name: Shop
        device: hanabata-r1
        interface: f1/1
        hosts: 10
        dhcp: { mode: server, on: hanabata-r1 }
      - id: hanabata-office
        name: Office
        device: hanabata-r1
        interface: f2/0
        hosts: 12
        subnet: 10.30.10.0/28
        dhcp: { mode: server, on: hanabata-r1 }   # the auto pool steps around the statics
        static:
          - { name: printer, ip: 10.30.10.5, role: label printer }
          - { name: nas01, ip: 10.30.10.10, role: file server }
    devices:
      - id: hanabata-r1
        name: HC-R1
        type: router
        interfaces:
          - { name: f0/0, role: wan }
          - { name: f0/1, role: p2p }
          - { name: f1/0 }
          - { name: f1/1 }
          - { name: f2/0 }
      - { id: hanabata-sw-kitchen, name: Kitchen switch, type: switch, uplink: hanabata-r1:f1/0 }
      - { id: hanabata-sw-shop, name: Shop switch, type: switch, uplink: hanabata-r1:f1/1 }
      - { id: hanabata-sw-office, name: Office switch, type: switch, uplink: hanabata-r1:f2/0 }
      - id: hanabata-nas
        name: nas01
        type: server
        interfaces:
          - { name: eth0, lan: hanabata-office, address: 10.30.10.10/28, link: hanabata-sw-office }

links:                    # point-to-point links that aren't WAN, VLAN or LAN
  - id: buried-cable
    name: Buried cable
    subnet: 10.255.0.0/30
    a: { endpoint: kokonoe-r1:f0/2 }            # address auto = .1
    b: { endpoint: hanabata-r1:f0/1 }           # address auto = .2

tunnels:
  - id: vpn-braintech-hanabata
    name: VPN Braintech – Hanabata
    type: ipsec-vti        # ipsec-policy | ipsec-vti | gre | gre-ipsec | wireguard
    a: { device: braintech-r1, underlay: f0/0 }   # peer IP = that interface's address
    b: { device: hanabata-r1, underlay: f0/0 }
    subnet: 10.255.255.0/30                     # required for vti/gre/wireguard, forbidden for ipsec-policy
    protected:                                  # default: all VLAN and LAN subnets of each side
      a: auto
      b: auto
    routing: static        # static | ospf | eigrp | bgp
    crypto:
      ike: 2
      encryption: aes-256
      integrity: sha256
      dh_group: 14
      lifetime_s: 86400
      psk_ref: "given by teacher"

# The values handed out for locked objects. If a locked object stops matching
# its baseline, the app reports LOCKED_CHANGED.
locked_baseline:
  isp:
    id: isp
    name: ISP
    devices:
      - id: isp-r1
        name: ISP
        type: router
        interfaces:
          - { name: f0/0, address: 203.0.113.1/28 }
          - { name: f0/1, address: 198.51.100.1/28 }
          - { name: f0/2, address: 198.51.100.17/30 }
          - { name: f1/0, address: 192.0.2.1/30 }
          - { name: f2/0, link: internet }
      - id: internet
        name: Internet
        type: cloud
```
