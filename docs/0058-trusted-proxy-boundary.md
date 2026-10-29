# Trusted proxy authority

Public-cloud packet CLOUD-07, 2026-10-28. This repairs client address authority in
the existing application; it does not establish a deployed public edge or close
the cloud release gate.

## Observed behavior and trace

`server/app.ts` previously selected `trustProxy: true` when
`TRUSTED_PROXY_CIDRS` was unset. `server/plugins/ip.ts` separately selected the
first matching vendor/forwarding header as `realIp`. A direct caller could choose
both addresses and make them disagree. Native guidance limits use Fastify's `ip`;
legacy rate configuration, identity network restrictions, audit context and Go
sidecar forwarding consume `realIp`. The current identity middleware passes that
address to the existing token service's trusted-IP check.

A failing unit characterization records different attacker-selected `ip` and
`realIp`. More importantly, the preceding canonical image
`sha256:80cd937b95773e4652195e440ea1ce504e233ca104102108bcf375af9de8ca04`
accepts a real machine token from a disallowed socket when a forged forwarding
header supplies the allowed address. The image test expected denial and received
HTTP 200. The disposable fixture cleaned up successfully. Receipt, relative to
the main checkout:
`.cache/trusted-proxy/.cache/proxy-boundary-LonwDr/result.json`.

The runtime now treats unset, empty and whitespace-only proxy configuration as
no proxy trust. Both address consumers use Fastify's resolved `ip`. Explicit
proxy addresses/CIDRs and aliases retain their existing framework validation and
right-to-left chain semantics; there is no parallel header-priority algorithm.
The pinned Fastify source and [official proxy configuration documentation](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)
were checked. Invalid ranges still fail startup. The original request-ip
attribution remains recorded in the rewritten module.

## Upgrade and rollback

Direct deployments need no proxy setting. Existing deployments behind an edge
must set `TRUSTED_PROXY_CIDRS` to the actual connecting proxy peers **before
upgrading**. Confirm client IPs, network allowlists, audit attribution, rate limits,
forwarded host/protocol and HTTPS behavior in staging. Trust only controlled peer
addresses; do not copy documentation example networks into production.

The trusted edge must strip untrusted forwarding metadata and emit the intended
`X-Forwarded-For`, host and protocol. An edge that only emits a vendor header must
normalize it there. `CF-Connecting-IP`, `X-Real-IP` and other vendor headers do not
independently determine identity. Restrict direct backend access to the intended
peers. The environment reference and Compose examples describe the new default;
no operator configuration is silently changed.

This deliberately changes unsafe implicit proxy behavior. It preserves the
explicit proxy deployment path, API routes, account/organization setup and the
encrypted store. There are no database migrations or additional credentials.
Prefer fixing an incorrect explicit peer configuration to rolling back the
security repair. A binary rollback restores the prior unsafe default unless the
explicit trust setting is retained; it is not a safe substitute for configuration.

## Executable acceptance

`server/plugins/ip.test.ts` covers all thirteen formerly recognized IP headers,
blank defaults, forwarded host/protocol, trusted and untrusted peers, multi-hop
chains, IPv6/mapped IPv4, aliases, missing metadata, invalid configuration,
actual native guidance limits and independent configured-proxy rate buckets.
These are in-process HTTP fixtures, not a real edge deployment.

`node scripts/test-proxy-boundary.mjs <local-image>` creates its own PostgreSQL,
Dragonfly and canonical application. It creates an owner, project and two
independent network-restricted machine identities through APIs. Both HTTP and MCP
must enforce the socket allowlist, reject forged-header elevation and retain
legitimate access. Rotating forwarding headers must not reset the native catalog
route budget; 429 must include a plain error and retry guidance. The fixture then
restarts with explicit loopback peer trust against the same disposable store and
checks positive forwarding and rejection at the nearest untrusted hop.

The explicit-trust phase uses real HTTP over container loopback, not a deployed
Nginx/CDN/TLS chain. No operator URL, secrets file or SQL fixture inserts are
accepted. Credentials stay in memory/runtime settings and never enter the result
receipt. The shared harness limits requests and removes only owned resources;
cleanup failure blocks success. The self-hosted build now requires this packet
against its verified immutable image, and orchestration fixtures exercise failure.

Full Linux backend tests and standalone application/browser, Dragonfly/Redis,
recovery and tenant-isolation checks remain required. Recorded results below only
cover their named scopes. Distributed rate quotas, tenant fairness, all identity
methods, Go sidecar network isolation, real edge deployment, enrollment, Nomen and
the remaining CLOUD-01 through CLOUD-08 gates remain open.
