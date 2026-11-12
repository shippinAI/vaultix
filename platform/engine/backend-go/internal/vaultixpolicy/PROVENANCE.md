# Vaultix policy source provenance

Source: the published Go module `github.com/infisical/gocasl`, version `v0.0.7`.
Module checksum: `h1:heG7W8O0Iq+iCWmscUm2cd29QuIq7mN9cSETm7DY7BY=`.

Copied from the checksum-verified local Go module cache, without connecting to
the engine snapshot host or cloning a repository. The MIT license and author
notice are preserved in `LICENSE`. Library source, internal packages, and tests
are included; examples and documentation are omitted.

Vaultix now maintains the evaluator directly in `internal/vaultixpolicy` as part
of its application module. There is no external module alias, nested module,
replacement directive or call-through implementation. All Go permission consumers
import this internal package directly.

The action/rule API, valid-policy evaluation semantics, packed-role format and
regression cases are retained and adapted from the source identified above.
Vaultix authors the bounded immutable authority snapshot, strict malformed-policy
validation, persisted-tuple validation, safe collection comparison and absent-policy
denials. Retaining correct implementation is deliberate capability preservation;
this is not a claim of independent origin for retained code.

The original MIT notice remains verbatim in LICENSE. Both files ship in the
canonical image under /backend/notices. Run the package and its actual permission,
assumed-privilege and reference consumers through scripts/test-vaultix-policy.mjs
and scripts/test-vaultix-policy-image.mjs before accepting changes.
