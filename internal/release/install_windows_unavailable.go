//go:build !windows

package release

import (
	"context"
	"errors"
)

func windowsCLIInstallation(string) (CLIInstallResult, error) {
	return CLIInstallResult{}, errors.New("Windows package registration is unavailable on this OS")
}
func installWindowsCLI(context.Context, CLIInstallOptions) (CLIInstallResult, error) {
	return CLIInstallResult{}, errors.New("Windows package registration is unavailable on this OS")
}
