package release

import (
	"archive/zip"
	"context"
	"debug/pe"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

func checkWindowsNativeCLI(ctx context.Context, packagePath string, m ReleaseManifest) error {
	z, err := zip.OpenReader(packagePath)
	if err != nil {
		return err
	}
	defer z.Close()
	var executable *zip.File
	for _, f := range z.File {
		if f.Name == "vaultix.exe" {
			executable = f
		}
	}
	if executable == nil {
		return errors.New("packaged native CLI is missing")
	}
	a, err := windowsCLIArtifact(m, "vaultix")
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp(filepath.Dir(packagePath), ".native-check-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	if err = privateWindowsPath(dir, true); err != nil {
		return err
	}
	path := filepath.Join(dir, "vaultix.exe")
	in, err := executable.Open()
	if err != nil {
		return err
	}
	defer in.Close()
	if err = writeDownloadFile(path, io.LimitReader(in, a.Bytes+1)); err != nil {
		return err
	}
	a.Name = "vaultix.exe"
	if err = verifyReleaseFile(dir, a); err != nil {
		return err
	}
	file, err := pe.Open(path)
	if err != nil {
		return errors.New("packaged CLI is not a native PE executable")
	}
	valid := file.Machine == pe.IMAGE_FILE_MACHINE_AMD64 && file.Characteristics&pe.IMAGE_FILE_EXECUTABLE_IMAGE != 0 && file.Characteristics&pe.IMAGE_FILE_DLL == 0
	_, pe64 := file.OptionalHeader.(*pe.OptionalHeader64)
	file.Close()
	if !valid || !pe64 {
		return errors.New("packaged CLI platform is incompatible")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, "version", "--json")
	command.Env = []string{"VAULTIX_DISABLE_UPDATE_CHECK=1"}
	command.Stderr = io.Discard
	var output boundedVersionOutput
	command.Stdout = &output
	if command.Run() != nil {
		return errors.New("packaged CLI failed native version check")
	}
	var value struct{ Product, Version, Revision, OS, Arch string }
	d := json.NewDecoder(&output)
	d.DisallowUnknownFields()
	if d.Decode(&value) != nil || value.Product != "Vaultix CLI" || value.Version != m.Version || value.Revision != m.Revision || value.OS != "windows" || value.Arch != "amd64" || d.Decode(new(any)) != io.EOF {
		return errors.New("packaged CLI identity differs from signed release")
	}
	return nil
}
