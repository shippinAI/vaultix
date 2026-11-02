//go:build !linux && !windows

package release

import "errors"

func publishDownload(string, string) error {
	return errors.New("unsupported release acquisition platform")
}
