//go:build !windows && !linux && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly

package store

import (
	"errors"
	"os"
)

func tryCredentialLock(*os.File) (bool, error) {
	return false, errors.New("credential locking is unavailable on this platform")
}
func releaseCredentialLock(*os.File) {}
