//go:build !linux

package release

import (
	"errors"
	"os"
)

func lockCLIInstall(*os.File) error     { return errors.New("CLI activation unsupported on this OS") }
func syncInstallDirectory(string) error { return errors.New("CLI activation unsupported on this OS") }
func exchangeCLI(string, string) error  { return errors.New("CLI activation unsupported on this OS") }
