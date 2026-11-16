# ip-planner (netplan)

Write one YAML file describing a lab network and get two things from it: an
IP plan laid out like a spreadsheet, and a topology diagram. Export both as a
PDF from the browser. It is a static site with no backend: everything runs in
the page.

- **Editor** on the left, with schema autocomplete, hover documentation and
  problems marked on the line they belong to.
- **Plan**: per-site tables for VLANs, static assignments, interfaces and
  switchports, plus links, VPN tunnels and external networks. Values you leave
  out (subnets, gateways, DHCP pools, link addresses) are computed and marked
  *auto*.
- **Topology**: a [D2](https://d2lang.com) diagram generated from the same file.
- **Export PDF**: A4 landscape through the browser's print dialog.

## Using it

Open the site, pick **Examples → Three companies, one ISP**, and edit. The file
format is documented in [docs/SCHEMA.md](docs/SCHEMA.md) (also under the
**Docs** tab in the app).

Things worth knowing:

- Subnets without a `subnet:` are allocated inside the site's `supernet`,
  largest first and then by VLAN id, so the result is the same every time.
  **Copy resolved YAML** writes all computed values into the file if you want to
  freeze them.
- A `/31` is rejected unless the link or tunnel sets `p2p: true`.
- Never put pre-shared keys in the file. `crypto.psk_ref` is free text such as
  "given by teacher".
- **Share link** puts the whole YAML into the URL. Anyone with the link can read
  it.

### Checks

Every problem has a stable code and points at a line.

| Code | Meaning |
| --- | --- |
| `YAML_SYNTAX` | The text is not valid YAML |
| `SCHEMA_*` | The file does not match the schema (unknown key, wrong type, missing field …) |
| `REF_UNKNOWN` | Reference to a device, interface, VLAN or icon that does not exist |
| `DUP_ID` | Duplicate id (shared by sites, external groups, devices, links, tunnels), VLAN id within a site, or interface name within a device |
| `VLAN_RANGE` | VLAN id outside 1–4094, or 1002–1005 |
| `NOT_NETWORK_ADDR` | A subnet is not written with its network address |
| `TOO_SMALL` | More hosts than usable addresses, or a /31 without `p2p: true` |
| `OUTSIDE_SUPERNET` | VLAN subnet outside its site's supernet |
| `OVERLAP` | Two subnets overlap, anywhere in the file |
| `ADDR_NOT_IN_SUBNET` | Gateway, static, pool bound, DHCP server or interface address outside its subnet |
| `ADDR_RESERVED` | Network or broadcast address used as a host |
| `ADDR_DUP` | The same address assigned twice |
| `ADDR_CONFLICT` | An interface's own address disagrees with the WAN or link that also sets it |
| `STATIC_IN_POOL` | Static address inside an explicit DHCP pool |
| `ALLOC_FAILED` | No room (or nothing to size from) for an auto-allocated subnet |
| `DHCP_RELAY_UNREACHABLE` | Relay server is in no subnet of the site (warning) |
| `TRUNK_VLAN_MISSING` | Trunk allows an undefined VLAN, or a VLAN with access ports reaches no router (warning) |
| `TUNNEL_PEER` | Tunnel underlay has no address (error) or is not a WAN/link interface (warning) |
| `TUNNEL_SUBNET` | Tunnel subnet missing, or present for policy-based IPsec |
| `TUNNEL_PROTECTED_OVERLAP` | The protected networks of the two sides overlap |
| `LOCKED_CHANGED` | A locked object differs from `locked_baseline` (warning) |
| `ICON_REMOTE` | Icon is an external URL and may not print (warning) |

Warnings do not stop the plan from rendering. With errors, the last good
version stays on screen, dimmed, until they are fixed.

## Icons

The device icons come from two collections, with thanks to their authors:

- **[Network-Icons-SVG](https://github.com/aci686/Network-Icons-SVG)** by
  aci686: the default icons for routers, switches, firewalls, servers and
  clouds.
- **[networking-icons](https://github.com/network-automation/networking-icons)**
  from Red Hat Ansible (Apache License 2.0): an alternative flat set under
  `icons/redhat/`.

Three more (access point, PC, ISP) were drawn for this project. Licences, the
exact files used and how to add your own are in [docs/ICONS.md](docs/ICONS.md).

## Development

```sh
npm install
npm run dev            # local server with hot reload
npm test               # unit tests
npm run test:coverage  # same, and requires 100 % coverage of src/ip
npm run lint
npm run build          # type-check and build into dist/
```

The schema is the single source of truth. After changing
`src/model/schema.json`, regenerate what is derived from it and commit the
result:

```sh
npm run gen:types      # src/model/types.ts
npm run gen:docs       # docs/SCHEMA.md
npm run check:schema   # what CI runs: fails on undocumented fields or stale files
```

Layout:

```
src/ip/         IPv4 maths: parsing, subnets, ranges, VLSM allocation (pure, fully tested)
src/model/      schema, YAML parsing, resolution of derived values, validation
src/render/     plan tables, D2 source generation, D2 rendering
src/editor/     CodeMirror setup, schema-driven completion and hover
src/app/        toolbar actions, persistence, share links
public/icons/   device icons
public/examples/ example files, listed in index.json
```

## Deployment

`.github/workflows/pages.yml` lints, checks the schema docs, tests, builds and
deploys `dist/` to GitHub Pages on every push to `main`. In the repository
settings, set **Pages → Source** to **GitHub Actions**. The site is served from
`https://<user>.github.io/<repo>/`; the workflow sets the base path from the
repository name, so renaming the repository needs no code change.

## Third-party software

Bundled at build time: [D2](https://github.com/terrastruct/d2) (MPL-2.0),
[CodeMirror](https://codemirror.net) (MIT), [yaml](https://eemeli.org/yaml/)
(ISC), [Ajv](https://ajv.js.org) (MIT), [lz-string](https://github.com/pieroxy/lz-string)
(MIT), [marked](https://marked.js.org) (MIT) and the
[IBM Plex](https://github.com/IBM/plex) typefaces (OFL-1.1). The site makes no
requests to other origins at run time.
