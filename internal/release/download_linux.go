package release

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func publishDownload(stage, target string) error {
	dir, err := os.Open(stage)
	if err != nil {
		return err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		return err
	}
	if err = unix.Renameat2(unix.AT_FDCWD, stage, unix.AT_FDCWD, target, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	parent, err := os.Open(filepath.Dir(target))
	if err != nil {
		return err
	}
	defer parent.Close()
	return parent.Sync()
}
