# Mesh knowledge personas and scripted-event benchmark scaffold

Owner: AngryVibes LLC. Product: Vaultix.cloud. Suite: DevSCIF.com.  
Plan date: 2026-11-06 (America/New_York).  
Status: **research + scaffold only; runtime mesh execution is not enabled by this packet**.

This packet defines the internal mesh knowledge/persona model and a benchmark
program for scripted UI events versus Playwright+screenshot automation. It
extends [0114](0114-domain-scripted-ui-standard.md), [0076](0076-recorded-workflows-and-visible-assist.md)
and [0024](0024-interaction-and-teaching-system.md). It does not introduce
new runtime authority, hidden model permissions, or secret-value handling.

## 1. Why this exists

The current scripted-event standard defines how AI invokes domain-owned actions
visibly and safely. It does not yet define:

1. Dedicated knowledge personas for internal mesh expertise.
2. Dynamic trigger records for `knowledge-drop` / `did-you-know` guidance.
3. A fair, repeatable benchmark proving efficiency gains over selector-driven
   browser automation.

This packet fills those gaps as contracts and implementation guidance.

## 2. Knowledge persona model (scaffold)

A persona is a reviewed knowledge owner for one bounded area (for example:
auth sessions, cert lifecycle, secrets reference flow). Personas are metadata
and guidance policy, not direct permission grants.

Canonical scaffold contract:  
[vaultix.mesh-knowledge-personas.v1.schema.json](/D:/localdev/vaultix/contracts/vaultix.mesh-knowledge-personas.v1.schema.json)

Example manifest:  
[mesh-knowledge-personas.example.v1.json](/D:/localdev/vaultix/docs/interaction/mesh-knowledge-personas.example.v1.json)

### Required persona invariants

- Stable `persona_id` and explicit `domain`.
- Human-readable capability and boundary statements.
- Allowed event IDs are explicit and bounded.
- Safety constraints list what this persona must refuse.
- Versioned ownership and review timestamp are mandatory.

## 3. Dynamic knowledge trigger model (scaffold)

A trigger record decides when a guidance nugget appears as a `knowledge-drop`
or `did-you-know` item during a scripted workflow.

Canonical scaffold contract:  
[vaultix.mesh-knowledge-trigger.v1.schema.json](/D:/localdev/vaultix/contracts/vaultix.mesh-knowledge-trigger.v1.schema.json)

Example trigger set:  
[mesh-knowledge-trigger.example.v1.json](/D:/localdev/vaultix/docs/interaction/mesh-knowledge-trigger.example.v1.json)

### Trigger invariants

- `trigger_id`, `event_type`, and `persona_id` are required.
- Trigger logic is bounded metadata (no arbitrary expressions or code eval).
- Payload is guidance-only (no secret values, passwords, MFA answers, tokens).
- Every trigger has a suppression window and replay guard policy.

## 4. Catamorphism/feedback fold for AI reprocessing

For this project, “catamorphism” is implemented as a deterministic feedback fold:

1. Scripted event executes (or is denied/fails).
2. The visible receipt emits bounded outcome metadata.
3. Trigger matcher evaluates only allowlisted facts.
4. Matching knowledge item is emitted to the visible assist surface.
5. Persona digest is updated for subsequent step planning.

The fold is additive and reversible by version. It cannot mutate business data
outside existing authorized handlers.

## 5. Benchmark protocol against Playwright + screenshots

The benchmark must compare equivalent user goals, not different tasks.

### 5.1 Workload parity gate

For each compared workflow:

- Same login state and tenant scope.
- Same target task completion criteria.
- Same number of business mutations.
- Same error/retry policy and timeout budget.

If any parity dimension differs, the run is invalid.

### 5.2 Required metrics

Per run, record:

- Model input/output tokens and call count.
- Wall-clock latency to completion.
- Browser interaction count.
- Screenshot/frame capture count and bytes.
- CPU and peak memory for agent + browser process.
- Human-visible error rate and recovery success rate.

### 5.3 Anti-gaming controls

- Use fixed seed data and fixed scenario matrix.
- Do not drop required confirmations to reduce steps.
- Do not remove failure/recovery cases from one side only.
- Publish raw receipts for both methods.
- Label fixture and live-provider evidence separately.

## 6. Current scope limits

- No mesh runtime service is added here.
- No new MCP execution capability is exposed here.
- No tenant secret values are added to guidance payloads.
- No claim of production efficiency is made without measured receipts.

## 7. Benchmark harness scaffold status

Benchmark harness scaffolding is now added with:

- [vaultix.ui-benchmark-receipt.v1.schema.json](/D:/localdev/vaultix/contracts/vaultix.ui-benchmark-receipt.v1.schema.json)
- [ui-benchmark-receipt.example.v1.json](/D:/localdev/vaultix/docs/interaction/ui-benchmark-receipt.example.v1.json)
- [check-ui-benchmark-receipt.mjs](/D:/localdev/vaultix/scripts/check-ui-benchmark-receipt.mjs)
- [ui-benchmark-receipt.test.mjs](/D:/localdev/vaultix/scripts/ui-benchmark-receipt.test.mjs)

This packet still does not claim measured production savings. It adds receipt
structure and guard checks so parity benchmark runs can be captured consistently.

## 8. Remaining implementation packet (after scaffold)

1. Bind persona manifests into existing domain workflow registry.
2. Implement trigger matcher in the visible assist state pipeline.
3. Run parity benchmark on public+auth workflow first, then tenant workflow.
4. Publish reviewed receipts for scripted-event and Playwright baselines.
