# 0008 — The layman gap: Doppler-class UX on a Vaultix engine

**Status:** strategy (2026-08-20)
**Owner:** AngryVibes LLC. **Host:** shippin.ai. **Product:** Vaultix.
Competing with Doppler is in-scope (grant). The engine is ours (doc 0011).
**Two audiences:** (1) the Vaultix build plan; (2) shareable analysis of
the layman gap. **Clyffy's orchestration is NOT shared.**

## 1. The honest read

vaultix is basic but does a few things genuinely well; Doppler is a
managed SaaS that wins on one axis almost entirely: **a non-expert can
succeed in minutes with zero ops.** Neither is built for the Lovable-type
user Vaultix teaches (doc 0002). That's the opening.

| Axis | vaultix (self-host core) | Doppler (managed) | Vaultix target |
|------|----------------------------|-------------------|----------------|
| Onboarding | project/env/CLI concepts up front | sign up → connect → runs | **guided, in-viewport, Clyffy-driven** (doc 0009) |
| Mental model | secrets/projects/envs, some jargon | "configs" that just sync | one box per app; plain words (doc 0002) |
| Propagation | integrations, manual wiring | dependable auto-sync everywhere | visible sync the user watches happen |
| Local dev | CLI `run`/inject | polished local support | inject-not-paste, shown live |
| Rotation | dynamic secrets (real strength) | automated, zero-touch | keep vaultix's dynamic edge, make it one-click |
| Versioning | present | clean history UI | history the user can read |
| Ops burden | you host + operate | none | you host; Clyffy operates it *for* the user, visibly |
| Scanning | ships secret scanning (strength) | — | keep it, surface it in plain language |

**vaultix's real strengths to preserve, not discard:** dynamic/short-lived
secrets, secret scanning, self-hostability, openness. Doppler has none of
the first two. Vaultix keeps vaultix's engine strengths and adds Doppler's
approachability — that's the "bring the two together."

## 2. The gap is UX, not engine

Doppler's advantages are almost all presentation and workflow: intuitive UI,
guided onboarding, visible propagation, zero-jargon language, managed feel.
The leftover dump already had some engine capabilities. Vaultix **did**
rebuild the store (doc 0011, `vaultix_*`). This doc is still the **layman
UX backlog** on top of that owned engine — not a reason to wrap leftover.

## 3. What Vaultix builds (capability backlog)

1. **Guided, in-viewport onboarding** — the first-project flow driven by the
   Vaultix specialist Clyffy operating the real UI while the user watches
   (doc 0009). Replaces jargon-first setup.
2. **Plain-language surface** — "one box per app" instead of
   projects/envs/secrets; the panel names things the way doc 0002 does.
3. **Visible propagation** — when a secret lands or rotates, the user sees
   it flow to the workspace/devspace in the viewport, not silently.
4. **One-click rotation** on top of the core's dynamic-secret capability —
   vaultix's strength, made approachable.
5. **Readable history/versioning** — who changed what, in plain words.
6. **Inject-not-paste, demonstrated** — the lesson ladder (doc 0002) becomes
   live Clyffy actions, not videos.

## 4. What we share with the upstream

The table in §1 and the observation in §2 — "your engine is strong, your
layman onboarding is the gap, here's the shape of the fix." That's generous
strategic input. What we do **not** share: the Clyffy specialist
architecture (doc 0009), the viewport-operator model, or any Clyffy code —
that's the operator's IP and years of lead. The boundary is: ideas about
*their* UX, yes; *our* orchestration, no.

Sources: Doppler's own comparison positioning (doppler.com/doppler-vs-vaultix),
vaultix vs Doppler analyses (Security Boulevard, guptadeepak.com, 2026).
