---
name: costar-alignment
description: Ground a new or changed Vaultix request in Context, Objective, Style, Tone, Audience and Response before planning. Use focused choices for material ambiguity after inspecting available context.
---

Read the root AGENTS.md and `.ai/README.md`; resolve paths from this checkout,
never from a remembered drive or provider-specific home directory.

Infer the six CO-STAR dimensions from the user's request, accepted decisions,
current roadmap and relevant code. Record each dimension as explicit, inferred
or unknown, with a short basis. Do not invent facts to fill the form. Record
constraints, success outcomes and exclusions separately; style cannot override
security, compatibility or correctness. Save an `alignment` event in the journal.

Before asking, inspect sources likely to contain the answer. Ask only about
uncertainty that changes the design, acceptance or user experience. Use one
focused question at a time, or up to three tightly related questions. Give two
or three concrete, mutually exclusive options, a recommendation with its reason,
and a short consequence for each. Allow free text. Do not offer a shortcut that
weakens stated requirements, or make the user choose implementation minutiae
already settled by the code. A selected default is not an answer.

Example: for chat retention, distinguish local visible-message capture, local
summaries, and reviewed publication. Explain privacy and resume consequences;
do not ask whether to skip journaling. For UI, show the concrete design choice
and its accessibility/loading tradeoff before asking for direction.

Confirm the inferred objective briefly in ordinary language; do not expose an
internal reasoning transcript or force the user through a six-question form.
Continue independent read-only/design work while an answer is pending. State
reasonable assumptions for optional choices after allowing time to respond.
Required approval or external authority never comes from silence. On correction,
append the new decision and revise the plan without erasing the earlier record.

Use `grounded-delivery` next for implementation work. CO-STAR organizes intent;
it is not evidence that the requested capability already exists.
