# netplan YAML schema (version 1)

> **Generated file.** Produced from `src/model/schema.json` by `scripts/gen-schema-docs.ts`.
> Do not edit it by hand; change the schema and run `npm run gen:docs`.

## Conventions

- **Ids.** Every object has a stable `id` (a lowercase slug) that other parts of the file refer to. `name` is only display text.
- **References.** An interface is referred to as `device-id:interface-name`, for example `bluestar-r1:f0/0`.
- **Addresses.** CIDR notation is used wherever a prefix makes sense (`172.16.100.1/27`).
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
| `locked_baseline` | map of object | no |  | The values you were given for locked objects, keyed by the object's id (for a VLAN use `<site-id>:<vlan-id>`, e.g. `linky:10`). Each value is a copy of the object exactly as it was handed out. When an object marked `locked: true` no longer matches its baseline, the app reports `LOCKED_CHANGED`. The `locked` flag itself is ignored in the comparison.<br>Example: `{"isp":{"id":"isp","name":"ISP","devices":[]}}` |

## Meta

Document information shown on the cover of the plan.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `title` | string | no |  | Title of the plan. Also used in the PDF footer and as the suggested file name when saving.<br>Example: `Lab 5 – Linky / SilverCrest / Bluestar` |
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
| `id` | [Slug](#slug) | yes |  | Identifier of the group. Must be unique among all sites, external groups, devices, links and tunnels. |
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
        address: 203.12.20.17/28
```

## Site

One site: an address block, its VLANs and its devices.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the site. Must be unique among all sites, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id. |
| `supernet` | [CIDR](#cidr) | yes |  | Address block that every VLAN subnet of the site must fit inside. VLANs without a `subnet` are auto-allocated from it. |
| `color` | string | no |  | Colour of the site's header band in the plan and of its container in the topology, as a six-digit hex colour.<br>Example: `#16a34a` |
| `wan` | [Wan](#wan) | no |  | The site's connection to the outside world. |
| `vlans` | [Vlan](#vlan)[] | no |  | VLANs of the site. VLAN ids must be unique within the site. |
| `devices` | [Device](#device)[] | no |  | Devices located at the site. |
| `locked` | boolean | no | `false` | Marks the site as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text shown under the site heading in the plan. |

## Wan

A site's uplink: which interface faces the provider, its address and the next hop.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `device` | [Slug](#slug) | yes |  | Id of the device that holds the WAN interface. Must be a device of this site. |
| `interface` | string | yes |  | Name of the WAN interface on that device. The interface must be listed under the device's `interfaces`.<br>Example: `f0/0` |
| `address` | [CIDR](#cidr) | no |  | Address and prefix of the WAN interface. May be given on the interface itself instead; if both are given they must be equal.<br>Example: `203.12.20.30/28` |
| `gateway` | [IPv4 address](#ipv4-address) | no |  | Next-hop address of the provider. Must be inside the WAN subnet. If another device has an interface with this address, the topology draws the WAN connection to it.<br>Example: `203.12.20.17` |
| `nat` | boolean | no | `false` | Whether the site's private addresses are translated (NAT/PAT) on this interface. |

## Vlan

A VLAN and its subnet. Give either `hosts` (the subnet is then auto-allocated inside the site supernet) or an explicit `subnet`, or both.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | integer | yes |  | VLAN id, 1–4094. Ids 1002–1005 are reserved on Cisco equipment and are rejected. Must be unique within the site.<br>Example: `10` |
| `name` | string | no |  | Name of the VLAN.<br>Example: `Marknad` |
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
name: Marknad
hosts: 40
dhcp:
  mode: server
  on: linky-r1
```

## Dhcp

DHCP settings of a VLAN.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | `server` \| `relay` \| `none` | yes |  | Where DHCP leases for the VLAN come from.<br>• `server`: A device of the site runs the DHCP pool itself; name it with `on`.<br>• `relay`: The gateway forwards DHCP requests to the server given in `server` (ip helper-address).<br>• `none`: No DHCP in this VLAN; all hosts are static. |
| `on` | [Slug](#slug) | no |  | Id of the device that runs the DHCP pool. Used with `mode: server`. |
| `server` | [IPv4 address](#ipv4-address) | no |  | Address of the DHCP server. With `mode: relay` it is where requests are relayed to, and a warning is shown if it is not inside any subnet of the same site. With `mode: server` it is optional and names a server that sits in this VLAN, so it must be inside the VLAN's subnet. |
| `pool` | [Pool](#pool) | no |  | Range of addresses handed out. Defaults to the address after the gateway up to the last usable address. |
| `exclude` | string[] | no |  | Addresses or ranges inside the pool that must not be handed out. Each entry is a single address or `first-last`.<br>Example: `["10.10.1.2-10.10.1.19","10.10.1.50"]` |

## Pool

An inclusive range of addresses handed out by DHCP.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `start` | [IPv4 address](#ipv4-address) | yes |  | First address of the pool. |
| `end` | [IPv4 address](#ipv4-address) | yes |  | Last address of the pool. |

## StaticEntry

One hand-assigned address in a VLAN.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | What the address belongs to. If it equals the id or name of a device that has the same address on an interface, the two are treated as the same assignment rather than a duplicate.<br>Example: `dhcp01` |
| `ip` | [IPv4 address](#ipv4-address) | yes |  | The assigned address. Must be a host address inside the VLAN subnet and outside the DHCP pool. |
| `role` | string | no |  | Free text describing what the host does.<br>Example: `DHCP server` |

## Device

A network device or host. Routers and hosts list `interfaces`; switches list `ports` (and may also have interfaces, for example a management SVI).

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the device. Must be unique among all sites, external groups, devices, links and tunnels. Used in references such as `linky-r1:f0/0`. |
| `name` | string | no |  | Display name (for example the hostname). Defaults to the id. |
| `type` | `router` \| `switch` \| `l3switch` \| `firewall` \| `ap` \| `server` \| `pc` \| `cloud` \| `isp` | yes |  | Kind of device. Decides the default icon in the topology.<br>• `router`: Router.<br>• `switch`: Layer 2 switch.<br>• `l3switch`: Multilayer (layer 3) switch.<br>• `firewall`: Firewall.<br>• `ap`: Wireless access point.<br>• `server`: Server.<br>• `pc`: Workstation or other end host.<br>• `cloud`: A cloud node standing for a network you do not model in detail, such as the internet. Other interfaces can link to it by its id.<br>• `isp`: A provider node, when the ISP is drawn as a single box rather than a router. |
| `icon` | string | no |  | Icon used in the topology. A built-in icon name (`router`), a path relative to the site root (`icons/custom/fw.svg`), or an absolute `https://` URL (passed through as-is; may not print). Defaults to the device type.<br>Example: `l3switch`, `icons/custom/fw.svg` |
| `interfaces` | [Interface](#interface)[] | no |  | Routed interfaces of the device. Interface names must be unique within the device. |
| `ports` | [Port](#port)[] | no |  | Switch ports of the device, given as ranges that share the same configuration. |
| `locked` | boolean | no | `false` | Marks the device as given and not to be changed. It is shown with a lock badge, and compared with `locked_baseline` when a baseline exists for its id. |
| `notes` | string | no |  | Free text about the device. |

## Interface

A routed interface. Its address may be written here, or come from the site `wan`, from a `links` entry that names it as an endpoint, or from its sub-interfaces.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `name` | string | yes |  | Interface name as used on the device, without spaces.<br>Example: `f0/0`, `g0/0/1`, `vlan99` |
| `address` | [CIDR](#cidr) | no |  | Address and prefix of the interface. Omit it for interfaces whose address comes from the site `wan` or from a link. |
| `role` | `wan` \| `lan` \| `trunk` \| `p2p` \| `mgmt` \| `loopback` | no |  | What the interface is used for. Shown in the interface table.<br>• `wan`: Faces the provider. A valid underlay for tunnels.<br>• `lan`: Routed interface in a single LAN or VLAN.<br>• `trunk`: Carries several VLANs, normally with sub-interfaces (router-on-a-stick).<br>• `p2p`: End of a point-to-point link.<br>• `mgmt`: Management interface, such as a switch SVI.<br>• `loopback`: Loopback interface. |
| `vlan` | integer | no |  | VLAN id (of the device's site) that this interface sits in, for example a switch SVI or a server NIC. The address must then be inside that VLAN's subnet. |
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
| `id` | [Slug](#slug) | yes |  | Identifier of the link. Must be unique among all sites, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id.<br>Example: `Nedgrävd kabel` |
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
| `endpoint` | string | yes |  | The interface at this end, as `device-id:interface-name`. The interface must be listed under the device's `interfaces`.<br>Example: `silvercrest-r1:f0/0` |
| `address` | [Address](#address) | no |  | Address of this end. Defaults to the first (side a) or second (side b) usable address of the link subnet. |

## Tunnel

A VPN tunnel between two devices. Never put keys in the file: `crypto.psk_ref` is a free-text pointer to where the key comes from.

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | [Slug](#slug) | yes |  | Identifier of the tunnel. Must be unique among all sites, external groups, devices, links and tunnels. |
| `name` | string | no |  | Display name. Defaults to the id.<br>Example: `VPN Linky – Bluestar` |
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

Examples: `linky-r1`

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

Examples: `linky-r1:f0/1`, `internet`

### ProtectedSide

Either `auto` or an explicit list of networks.

- `auto`: All VLAN subnets of the site the tunnel device belongs to.
- [CIDR](#cidr)[]: Explicit list of networks in CIDR notation.

Examples: `auto`, `["10.10.1.0/26"]`

## Full example

This is `public/examples/three-companies.yaml`, which is also available under **Load example** in the app. All values are illustrative.

```yaml
# Example: three companies connected through one ISP.
#
# ILLUSTRATIVE VALUES ONLY. Nothing in this file is the real assignment; it
# exists to show every part of the schema. Replace the addresses, VLANs and
# device names with the ones you were given.

version: 1
meta:
  title: "Lab 5 – Linky / SilverCrest / Bluestar"
  authors: ["ntsu"]
  date: 2026-11-16
  notes: |
    ISP and everything inside the red circle may not be changed.
    All values in this example are illustrative.

diagram:
  layout: dagre          # dagre | elk
  direction: right       # up | down | left | right (right fits a landscape page best)
  theme: default         # default | dark | sketch

external:                # things you connect to but don't own
  # Illustrative: a made-up ISP with made-up public addresses.
  - id: isp
    name: ISP
    locked: true
    devices:
      - id: isp-r1
        name: ISP
        type: router
        interfaces:
          - { name: f0/1, address: 203.12.20.17/28 }
          - { name: f0/0, address: 194.50.16.33/28 }
          - { name: f1/0, address: 85.24.7.1/30 }
          - { name: f2/0, link: internet }   # link to a cloud node with no address
      - id: internet
        name: Internet
        type: cloud

sites:
  # Illustrative: LinkyAB is not the real site from the assignment.
  - id: linky
    name: LinkyAB
    supernet: 10.10.0.0/16
    color: "#16a34a"
    wan:
      device: linky-r1
      interface: f0/0
      address: 203.12.20.30/28
      gateway: 203.12.20.17
      nat: true
    vlans:
      - id: 10
        name: Marknad
        hosts: 40
        # subnet omitted → auto-allocated (VLSM) inside supernet
        dhcp: { mode: server, on: linky-r1 }
      - id: 20
        name: Produktion
        hosts: 60
        subnet: 10.10.1.0/26
        gateway: 10.10.1.1/26          # default: first usable
        dhcp:
          mode: relay
          server: 10.10.99.10
          pool: { start: 10.10.1.20, end: 10.10.1.62 }
          exclude: [10.10.1.2-10.10.1.19]
      - id: 99
        name: Management
        hosts: 10
        subnet: 10.10.99.0/28
        native: false
        static:
          - { name: Huvudswitch_Linky, ip: 10.10.99.2, role: switch-mgmt }
          - { name: dhcp01, ip: 10.10.99.10, role: DHCP server }
    devices:
      - id: linky-r1
        name: LinkyAB
        type: router
        interfaces:
          - { name: f0/0, role: wan }
          - name: f0/1
            role: trunk
            subinterfaces: auto        # one .<vlan> subif per VLAN, address = VLAN gateway
      - id: linky-sw1
        name: Huvudswitch_Linky
        type: l3switch
        icon: l3switch                 # optional; defaults to type
        ports:
          - { range: "g0/1", mode: trunk, allowed: [10, 20, 99], link: linky-r1:f0/1 }
          - { range: "f0/1-10", mode: access, vlan: 10 }
          - { range: "f0/11-20", mode: access, vlan: 20 }
          - { range: "f0/24", mode: access, vlan: 99 }
      - id: linky-dhcp01
        name: dhcp01
        type: server
        interfaces:
          - { name: eth0, vlan: 99, address: 10.10.99.10/28, link: linky-sw1:f0/24 }

  # Illustrative: SilverCrest is not the real site from the assignment.
  - id: silvercrest
    name: SilverCrest
    supernet: 10.20.0.0/16
    color: "#64748b"
    wan:
      device: silvercrest-r1
      interface: f0/1
      address: 85.24.7.2/30
      gateway: 85.24.7.1
      nat: true
    vlans:
      - id: 10
        name: Kontor
        hosts: 25
        growth_percent: 20
        dhcp: { mode: server, on: silvercrest-r1 }
      - id: 30
        name: Lager
        hosts: 12
        dhcp: { mode: server, on: silvercrest-r1 }
    devices:
      - id: silvercrest-r1
        name: SilverCrest
        type: router
        interfaces:
          - { name: f0/1, role: wan }
          - { name: f0/0, role: p2p }
          - { name: f1/0, role: trunk, subinterfaces: auto }
      - id: silvercrest-sw1
        name: Switch_SilverCrest
        type: switch
        ports:
          - { range: "g0/1", mode: trunk, allowed: [10, 30], link: silvercrest-r1:f1/0 }
          - { range: "f0/1-16", mode: access, vlan: 10 }
          - { range: "f0/17-24", mode: access, vlan: 30 }

  # Illustrative: Bluestar AB is not the real site from the assignment.
  - id: bluestar
    name: Bluestar AB
    supernet: 172.16.100.0/24
    color: "#2563eb"
    wan: { device: bluestar-r1, interface: f0/1, address: 194.50.16.46/28, gateway: 194.50.16.33, nat: true }
    vlans:
      - id: 10
        name: Admin
        hosts: 20
        subnet: 172.16.100.0/27
        dhcp: { mode: server, on: bluestar-r1 }
      - id: 20
        name: Utveckling
        hosts: 50
        dhcp: { mode: server, on: bluestar-r1 }
    devices:
      - id: bluestar-r1
        name: Bluestar
        type: router
        interfaces:
          - { name: f0/1, role: wan }
          - { name: f0/0, role: p2p }
          - { name: f1/0, role: trunk, subinterfaces: auto }
      - id: bluestar-sw1
        name: Switch_Bluestar
        type: switch
        ports:
          - { range: "g0/1", mode: trunk, allowed: [10, 20], link: bluestar-r1:f1/0 }
          - { range: "f0/1-12", mode: access, vlan: 10 }
          - { range: "f0/13-24", mode: access, vlan: 20 }

links:                    # point-to-point links that aren't WAN or VLAN
  - id: buried-cable
    name: Nedgrävd kabel
    subnet: 10.255.0.0/30
    a: { endpoint: silvercrest-r1:f0/0 }        # address auto = .1
    b: { endpoint: bluestar-r1:f0/0 }           # address auto = .2

tunnels:
  - id: vpn-linky-bluestar
    name: VPN Linky – Bluestar
    type: ipsec-vti        # ipsec-policy | ipsec-vti | gre | gre-ipsec | wireguard
    a: { device: linky-r1, underlay: f0/0 }     # peer IP = that interface's address
    b: { device: bluestar-r1, underlay: f0/1 }
    subnet: 10.255.255.0/30                     # required for vti/gre/wireguard, forbidden for ipsec-policy
    protected:                                  # default: all VLAN subnets of each side
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

# The values the teacher handed out for locked objects. If a locked object
# stops matching its baseline, the app reports LOCKED_CHANGED.
locked_baseline:
  isp:
    id: isp
    name: ISP
    devices:
      - id: isp-r1
        name: ISP
        type: router
        interfaces:
          - { name: f0/1, address: 203.12.20.17/28 }
          - { name: f0/0, address: 194.50.16.33/28 }
          - { name: f1/0, address: 85.24.7.1/30 }
          - { name: f2/0, link: internet }
      - id: internet
        name: Internet
        type: cloud
```
