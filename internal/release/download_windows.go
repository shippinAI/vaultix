package release

import "golang.org/x/sys/windows"

func publishDownload(stage, target string) error {
	from, err := windows.UTF16PtrFromString(stage)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	// Deliberately omit REPLACE_EXISTING and COPY_ALLOWED. Stage and target
	// share a parent. No installed/running executable is moved.
	return windows.MoveFileEx(from, to, windows.MOVEFILE_WRITE_THROUGH)
}
