// Package compose supplies the same canonical deployment consumed by operators.
package compose

import _ "embed"

//go:embed vaultix.yml
var Definition []byte

//go:embed self.env.example
var EnvironmentExample []byte
