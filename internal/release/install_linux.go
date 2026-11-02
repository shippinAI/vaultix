package release

import (
	"errors"
	"golang.org/x/sys/unix"
	"os"
)

func lockCLIInstall(f *os.File) error {
	if unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		return errors.New("another CLI installation operation is active")
	}
	return nil
}
func syncInstallDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func exchangeCLI(stage, current string) error {
	return unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, current, unix.RENAME_EXCHANGE)
}
