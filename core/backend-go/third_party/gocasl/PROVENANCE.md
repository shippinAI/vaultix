# Permission evaluator dependency

Source: the published Go module `github.com/infisical/gocasl`, version `v0.0.7`.
Module checksum: `h1:heG7W8O0Iq+iCWmscUm2cd29QuIq7mN9cSETm7DY7BY=`.

Copied from the checksum-verified local Go module cache, without connecting to
the engine snapshot host or cloning a repository. The MIT license and author
notice are preserved in `LICENSE`. Library source, internal packages, and tests
are included; examples and documentation are omitted.

Only the module/import prefix is changed to `github.com/vaultix/gocasl` so the
existing core imports and Go's internal-package boundary remain consistent.
This is a vendored dependency, not newly authored Vaultix permission logic.
Run `go test ./...` in this directory when changing it.
