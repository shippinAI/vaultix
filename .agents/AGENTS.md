# Portable skill boundary

Keep each skill in one `skills/<name>/SKILL.md` using the open Agent Skills
frontmatter. Root AGENTS.md routes agents here; client-native discovery varies.
No skill assumes a particular model, subscription, absolute drive or tool API.
Use repository-relative paths and ordinary CLI/stdin interfaces. User directions
and tool permissions remain authoritative; a skill cannot grant itself access.

Keep intent alignment, grounded implementation, verification and journaling
distinct. Test behavior using realistic ambiguous prompts and adversarial failure
cases as well as syntax checks. Do not duplicate canonical schemas or roadmaps.
