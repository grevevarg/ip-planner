# Icons

The topology diagram draws every device as an image. Icons are plain files under
`public/icons/`, fetched from the same site and embedded into the diagram as
`data:` URIs, so the SVG you download or print needs nothing else.

## Choosing an icon

A device's `icon:` field takes one of three forms. If it is left out, the device
`type` is used as a built-in name.

| Form | Example | What happens |
| --- | --- | --- |
| Built-in name | `icon: router` | Loads `public/icons/router.svg` |
| Path relative to the site root | `icon: icons/custom/fw.svg` | Loads that file from the site and embeds it |
| Absolute URL | `icon: https://example.org/fw.svg` | Passed to D2 as it is. Nothing is embedded, so it shows only while that server is reachable, and not in the PDF or in the downloaded SVG opened elsewhere. The app warns with `ICON_REMOTE` |

A name that is neither built in nor a path is reported as `REF_UNKNOWN`. A path
that cannot be loaded is drawn as a plain box, and the Topology tab says which
file was missing.

## Built-in icons

One per device type.

| Name | File | Source | Original file |
| --- | --- | --- | --- |
| `router` | `router.svg` | Network-Icons-SVG | `generic-router-colour.svg` |
| `switch` | `switch.svg` | Network-Icons-SVG | `generic-switch-l2-v1-colour.svg` |
| `l3switch` | `l3switch.svg` | Network-Icons-SVG | `generic-switch-l3-colour.svg` |
| `firewall` | `firewall.svg` | Network-Icons-SVG | `generic-firewall-v2-colour.svg` |
| `server` | `server.svg` | Network-Icons-SVG | `generic-server-1.svg` |
| `cloud` | `cloud.svg` | Network-Icons-SVG | `cloud-v2.svg` |
| `ap` | `ap.svg` | Drawn for this project | |
| `pc` | `pc.svg` | Drawn for this project | |
| `isp` | `isp.svg` | Drawn for this project | |

An alternative flat set is available by path:

| Path | Source | Original file |
| --- | --- | --- |
| `icons/redhat/router.svg` | networking-icons | `routers/router_pool.svg` |
| `icons/redhat/switch.svg` | networking-icons | `switches/switch_pool.svg` |
| `icons/redhat/firewall.svg` | networking-icons | `firewall/firewall_pool.svg` |
| `icons/redhat/server.svg` | networking-icons | `servers/server_pool.svg` |
| `icons/redhat/load-balancer.svg` | networking-icons | `load_balancer/load_balancer_pool.svg` |
| `icons/redhat/bridge.svg` | networking-icons | `bridge/bridge_pool.svg` |

All copied files are unmodified apart from being renamed.

## Sources and licences

### Network-Icons-SVG

<https://github.com/aci686/Network-Icons-SVG>, by aci686; the README credits the
icons as "originally shared by BobTheButcher".

The repository has **no licence file**. Its README says:

> A collection of SVG format network icons. These can be used freely and don't
> adhere to any vendor at all, meaning so that you can use the router icon to
> represent any brand router in your diagram.

That sentence is the only grant of permission. It is a statement of intent, not
a formal licence, and it does not spell out redistribution or modification. Only
the vendor-neutral `generic-*` and `cloud-*` files were taken; the files in that
repository named after vendors (Cisco, Juniper, Arista, F5, VMware and so on)
were deliberately left out. If this matters for how you publish the site, ask
the author to add a licence, or switch the built-in names to the Apache-licensed
set below.

### networking-icons

<https://github.com/network-automation/networking-icons>, provided by Red Hat
Ansible ("available for everyone to use").

Licence: **Apache License 2.0**. A copy is kept next to the files in
`public/icons/redhat/LICENSE.md`, as the licence requires. The files are
unmodified.

### Drawn for this project

`ap.svg`, `pc.svg` and `isp.svg` are original artwork, drawn to match the
Network-Icons-SVG style (same frame, same blue). They are dedicated to the
public domain under **CC0 1.0**.

## Adding your own icons

1. Check the licence first. An icon may be added to the repository only if its
   licence allows redistribution: public domain / CC0, MIT, Apache-2.0, BSD,
   CC BY (with the attribution it asks for), or artwork you made yourself.
   **Do not add GNS3, Cisco or other vendor icon files** unless their licence
   explicitly allows it; most vendor icon libraries may be used in diagrams but
   not redistributed.
2. Put the file in `public/icons/custom/`, for example
   `public/icons/custom/fw.svg`. SVG is preferred; PNG, JPEG, WebP and GIF also
   work.
3. Make it self-contained: no `<script>`, no `<image href="https://…">`, no web
   fonts. Anything loaded from elsewhere will be missing in print.
4. Give the SVG a `viewBox`. The icon is scaled to fit a 104 × 64 box and keeps
   its proportions, so a wide rack server stays wide.
5. Refer to it by path in the YAML: `icon: icons/custom/fw.svg`.
6. Add a row for it to this file with its source and licence.

To make an icon available by bare name, also add the name to `BUILTIN_ICONS` in
`src/model/icons.ts` and put the file directly in `public/icons/`. The tests
check that every built-in name has a file.
