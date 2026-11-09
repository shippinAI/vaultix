package release

// Managed CLI installations are separate from credentials and instance data.
// A generation contains the actual native pair and the acceptance checkpoint;
// publication switches this whole directory, never individual executable names.
import (
	"bytes"
	"context"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

type CLIInstallOptions struct {
	Directory, Bundle, Trust, Version string
	Preview                           bool
	Progress                          io.Writer
}
type CLIInstallResult struct {
	SchemaVersion     string                  `json:"schemaVersion"`
	Directory         string                  `json:"directory"`
	BinDirectory      string                  `json:"binDirectory"`
	Version           string                  `json:"version"`
	Revision          string                  `json:"revision"`
	Platform          string                  `json:"platform"`
	Checkpoint        ReleaseCheckpoint       `json:"checkpoint"`
	Changed           bool                    `json:"changed"`
	PreviousDirectory string                  `json:"previousDirectory"`
	Verified          bool                    `json:"verified"`
	Windows           *CLIWindowsInstallation `json:"windows,omitempty"`
}

// Windows registration may be deferred while either native command is running.
// The top-level version is the requested target; Active describes independently
// verified registered bytes, and is nil before first activation.
type CLIWindowsInstallation struct {
	State           string            `json:"state"`
	Publisher       string            `json:"publisher"`
	PackageFamily   string            `json:"packageFamily"`
	PackageFullName string            `json:"packageFullName"`
	Active          *CLIWindowsActive `json:"active"`
}
type CLIWindowsActive struct {
	Version         string            `json:"version"`
	Revision        string            `json:"revision"`
	PackageFullName string            `json:"packageFullName"`
	Checkpoint      ReleaseCheckpoint `json:"checkpoint"`
}
type cliOwner struct {
	SchemaVersion string `json:"schemaVersion"`
	Platform      string `json:"platform"`
	TrustSHA256   string `json:"trustSha256"`
}
type cliAccepted struct {
	SchemaVersion string            `json:"schemaVersion"`
	AcceptedAt    string            `json:"acceptedAt"`
	Checkpoint    ReleaseCheckpoint `json:"checkpoint"`
}

func CLIInstallation(directory string) (CLIInstallResult, error) {
	if runtime.GOOS == "windows" {
		return windowsCLIInstallation(directory)
	}
	var result CLIInstallResult
	if err := installPlatform(); err != nil {
		return result, err
	}
	root, err := privateInstallPath(directory)
	if err != nil {
		return result, err
	}
	lock, err := openInstallLock(root, false)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	trust, err := installationTrust(root, "")
	if err != nil {
		return result, err
	}
	m, cp, err := installedCLI(root, trust, time.Now())
	if err != nil {
		return result, err
	}
	return cliResult(root, m, cp, false, ""), nil
}

func InstallCLI(ctx context.Context, o CLIInstallOptions) (CLIInstallResult, error) {
	if runtime.GOOS == "windows" {
		return installWindowsCLI(ctx, o)
	}
	return installCLI(ctx, o, time.Now, checkNativeCLI)
}

func installCLI(ctx context.Context, o CLIInstallOptions, now func() time.Time, check func(context.Context, string, ReleaseManifest) error) (CLIInstallResult, error) {
	var result CLIInstallResult
	if err := installPlatform(); err != nil {
		return result, err
	}
	if o.Directory == "" || (o.Bundle == "" && o.Version == "") {
		return result, errors.New("CLI installation requires a dedicated directory and a release bundle or exact version")
	}
	root, err := filepath.Abs(o.Directory)
	if err != nil {
		return result, err
	}
	parent, err := privateInstallPath(filepath.Dir(root))
	if err != nil || parent == root {
		return result, errors.New("installation parent must be an existing private real directory")
	}
	_, statErr := os.Lstat(root)
	fresh := errors.Is(statErr, os.ErrNotExist)
	if statErr != nil && !fresh {
		return result, errors.New("cannot inspect installation directory")
	}
	var work string
	if fresh {
		if o.Trust == "" {
			return result, errors.New("first installation requires preprovisioned release trust")
		}
		work, err = os.MkdirTemp(parent, ".vaultix-install-")
		if err != nil {
			return result, err
		}
		defer func() {
			if work != "" {
				_ = os.RemoveAll(work)
			}
		}()
	} else {
		if _, err = privateInstallPath(root); err != nil {
			return result, err
		}
		work = root
	}
	lock, err := openInstallLock(work, fresh)
	if err != nil {
		return result, err
	}
	defer lock.Close()
	var trust []byte
	var prior *ReleaseCheckpoint
	var old ReleaseManifest
	if fresh {
		trust, err = ReadReleaseMetadata(o.Trust, 16384)
	} else {
		trust, err = installationTrust(root, o.Trust)
		if err == nil {
			var cp ReleaseCheckpoint
			old, cp, err = installedCLI(root, trust, now())
			prior = &cp
		}
	}
	if err != nil {
		return result, err
	}
	acquired := ""
	if o.Bundle == "" {
		acquire, err := os.MkdirTemp(work, ".acquire-")
		if err != nil {
			return result, err
		}
		defer os.RemoveAll(acquire)
		acquired = acquire
		pinned := filepath.Join(acquire, "trust.json")
		if err = writeDownloadFile(pinned, bytes.NewReader(trust)); err != nil {
			return result, err
		}
		checkpointPath := ""
		if prior != nil {
			checkpointPath = filepath.Join(acquire, "checkpoint.json")
			if err = writeInstallJSON(checkpointPath, prior); err != nil {
				return result, err
			}
		}
		o.Bundle = filepath.Join(acquire, "bundle")
		if _, err = Download(ctx, DownloadOptions{Version: o.Version, Directory: o.Bundle, Trust: pinned, Checkpoint: checkpointPath, Preview: o.Preview, Progress: o.Progress}); err != nil {
			return result, err
		}
	}
	raw, err := ReadReleaseMetadata(filepath.Join(o.Bundle, "release-manifest.json"), 65536)
	if err != nil {
		return result, err
	}
	signed, err := ReadReleaseMetadata(filepath.Join(o.Bundle, "release-signature.json"), 4096)
	if err != nil {
		return result, err
	}
	m, cp, err := VerifyRelease(raw, signed, trust, now(), prior)
	if err != nil {
		return result, err
	}
	if o.Version != "" && o.Version != m.Version {
		return result, errors.New("release does not match requested version")
	}
	if (m.Channel == "preview") != o.Preview {
		return result, errors.New("preview installation requires explicit --preview")
	}
	if !fresh {
		if cp == *prior {
			return cliResult(root, old, *prior, false, ""), nil
		}
		next, _ := Parse(m.Version)
		before, _ := Parse(old.Version)
		if Compare(next, before) <= 0 {
			return result, errors.New("CLI downgrade or replacement of an accepted version is refused")
		}
	}
	if err = VerifyReleaseArtifacts(m, o.Bundle); err != nil {
		return result, err
	}
	// In a fresh root the generation is invisible until the whole root is
	// published. Updates stage under the locked root on the same filesystem.
	generation, err := os.MkdirTemp(work, ".generation-")
	if err != nil {
		return result, err
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(generation)
		}
	}()
	for _, name := range []string{"vaultix", "vaultixl"} {
		a, err := cliArtifact(m, name)
		if err != nil {
			return result, err
		}
		if err = copyCLIArtifact(filepath.Join(o.Bundle, a.Name), filepath.Join(generation, name), a); err != nil {
			return result, err
		}
	}
	if err = check(ctx, filepath.Join(generation, "vaultix"), m); err != nil {
		return result, err
	}
	for name, data := range map[string][]byte{"release-manifest.json": raw, "release-signature.json": signed} {
		if err = writeDownloadFile(filepath.Join(generation, name), bytes.NewReader(data)); err != nil {
			return result, err
		}
	}
	accepted := cliAccepted{"vaultix.cli-acceptance.v1", now().UTC().Format(time.RFC3339), cp}
	if err = writeInstallJSON(filepath.Join(generation, "accepted.json"), accepted); err != nil {
		return result, err
	}
	// Verify the bytes about to be activated, not merely their source bundle.
	if _, _, err = readCLIGeneration(generation, trust, now()); err != nil {
		return result, err
	}
	if _, _, err = VerifyRelease(raw, signed, trust, now(), prior); err != nil {
		return result, err
	}
	if err = ctx.Err(); err != nil {
		return result, errors.New("CLI installation cancelled before activation")
	}
	if err = syncInstallDirectory(generation); err != nil {
		return result, err
	}
	// A fresh root is renamed during publication. Remove our temporary download
	// before that rename so its cleanup cannot refer to the now-obsolete path.
	if acquired != "" {
		if err = os.RemoveAll(acquired); err != nil {
			return result, errors.New("cannot remove temporary acquisition before activation")
		}
	}
	current := filepath.Join(work, "current")
	if fresh {
		if err = writeDownloadFile(filepath.Join(work, "trust.json"), bytes.NewReader(trust)); err != nil {
			return result, err
		}
		if err = writeInstallJSON(filepath.Join(work, "owner.json"), cliOwner{"vaultix.cli-install.v1", "linux/amd64", hashBytes(trust)}); err != nil {
			return result, err
		}
		if err = publishDownload(generation, current); err != nil {
			return result, err
		}
		if err = syncInstallDirectory(work); err != nil {
			return result, err
		}
		if err = publishDownload(work, root); err != nil {
			return result, errors.New("installation publication failed; inspect destination before retry")
		}
		work = "" // Never remove a published root.
		return cliResult(root, m, cp, true, ""), nil
	}
	// Preserve the replaced generation. A killed process cannot turn an old
	// checkpoint into a new pair or leave either executable name absent.
	if err = exchangeCLI(generation, current); err != nil {
		return result, errors.New("atomic CLI activation unavailable or failed; current installation was not replaced")
	}
	keep = true
	if err = syncInstallDirectory(root); err != nil {
		return result, errors.New("CLI activation occurred but directory synchronization failed; inspect update status before retry")
	}
	return cliResult(root, m, cp, true, generation), nil
}

func cliResult(root string, m ReleaseManifest, cp ReleaseCheckpoint, changed bool, previous string) CLIInstallResult {
	return CLIInstallResult{SchemaVersion: "vaultix.cli-install-result.v1", Directory: root, BinDirectory: filepath.Join(root, "current"), Version: m.Version, Revision: m.Revision, Platform: "linux/amd64", Checkpoint: cp, Changed: changed, PreviousDirectory: previous, Verified: true}
}
func installPlatform() error {
	if runtime.GOOS != "linux" || runtime.GOARCH != "amd64" {
		return errors.New("native CLI activation is currently verified only on Linux/amd64; Windows installation is not yet available")
	}
	return nil
}
func privateInstallPath(path string) (string, error) {
	if path == "" {
		return "", errors.New("installation directory is required")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil || real != abs {
		return "", errors.New("installation paths cannot traverse links")
	}
	info, err := os.Lstat(abs)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return "", errors.New("installation directory must exclude group/other write access")
	}
	return abs, nil
}
func openInstallLock(root string, create bool) (*os.File, error) {
	path := filepath.Join(root, ".install.lock")
	if info, err := os.Lstat(path); err == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0) {
		return nil, errors.New("installation lock must be a private regular file")
	} else if err != nil && !create {
		return nil, errors.New("directory is not a managed CLI installation")
	}
	flags := os.O_RDWR
	if create {
		flags |= os.O_CREATE | os.O_EXCL
	}
	f, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		return nil, err
	}
	if err = lockCLIInstall(f); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
func installationTrust(root, supplied string) ([]byte, error) {
	var owner cliOwner
	raw, err := readInstallMetadata(filepath.Join(root, "owner.json"), 4096)
	if err != nil {
		return nil, errors.New("directory is not a managed Vaultix CLI installation; existing files are not adopted")
	}
	if decodeCanonical(raw, 4096, &owner) != nil || owner.SchemaVersion != "vaultix.cli-install.v1" || owner.Platform != "linux/amd64" {
		return nil, errors.New("unsupported CLI installation owner")
	}
	trust, err := readInstallMetadata(filepath.Join(root, "trust.json"), 16384)
	if err != nil || hashBytes(trust) != owner.TrustSHA256 {
		return nil, errors.New("installation trust changed")
	}
	if supplied != "" {
		provided, err := ReadReleaseMetadata(supplied, 16384)
		if err != nil || !bytes.Equal(trust, provided) {
			return nil, errors.New("updates cannot replace pinned installation trust")
		}
	}
	return trust, nil
}
func installedCLI(root string, trust []byte, now time.Time) (ReleaseManifest, ReleaseCheckpoint, error) {
	return readCLIGeneration(filepath.Join(root, "current"), trust, now)
}
func readCLIGeneration(dir string, trust []byte, now time.Time) (ReleaseManifest, ReleaseCheckpoint, error) {
	var m ReleaseManifest
	var cp ReleaseCheckpoint
	if _, err := privateInstallPath(dir); err != nil {
		return m, cp, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 5 {
		return m, cp, errors.New("unexpected files in CLI generation")
	}
	raw, err := readInstallMetadata(filepath.Join(dir, "accepted.json"), 4096)
	if err != nil {
		return m, cp, err
	}
	var accepted cliAccepted
	if decodeCanonical(raw, 4096, &accepted) != nil || accepted.SchemaVersion != "vaultix.cli-acceptance.v1" {
		return m, cp, errors.New("invalid CLI acceptance record")
	}
	at, err := parseReleaseTime(accepted.AcceptedAt)
	if err != nil || at.After(now.Add(5*time.Minute)) {
		return m, cp, errors.New("invalid CLI acceptance time")
	}
	raw, err = readInstallMetadata(filepath.Join(dir, "release-manifest.json"), 65536)
	if err != nil {
		return m, cp, err
	}
	signed, err := readInstallMetadata(filepath.Join(dir, "release-signature.json"), 4096)
	if err != nil {
		return m, cp, err
	}
	// Previously accepted code does not stop working when distribution metadata
	// expires. New activation still verifies against current time above.
	m, cp, err = VerifyRelease(raw, signed, trust, at, nil)
	if err != nil {
		return m, cp, err
	}
	if cp != accepted.Checkpoint {
		return m, cp, errors.New("CLI checkpoint differs from installed signed release")
	}
	for _, name := range []string{"vaultix", "vaultixl"} {
		a, err := cliArtifact(m, name)
		if err != nil {
			return m, cp, err
		}
		a.Name = name
		if err = verifyReleaseFile(dir, a); err != nil {
			return m, cp, err
		}
		info, err := os.Lstat(filepath.Join(dir, name))
		if err != nil || info.Mode().Perm()&0100 == 0 || info.Mode().Perm()&0022 != 0 {
			return m, cp, errors.New("installed CLI permissions are invalid")
		}
	}
	return m, cp, nil
}
func readInstallMetadata(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return nil, errors.New("installation metadata must be a private regular file")
	}
	return ReadReleaseMetadata(path, limit)
}
func cliArtifact(m ReleaseManifest, name string) (ReleaseArtifact, error) {
	for _, a := range m.Artifacts {
		if a.Kind == "cli" && a.Platform == "linux/amd64" && a.Name == name+"-linux-amd64" {
			if a.Bytes > 256<<20 {
				return a, errors.New("CLI executable exceeds 256 MiB limit")
			}
			return a, nil
		}
	}
	return ReleaseArtifact{}, errors.New("matching native CLI artifact is missing")
}
func copyCLIArtifact(source, target string, a ReleaseArtifact) error {
	info, err := os.Lstat(source)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("CLI source must be a regular file")
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	opened, err := in.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return errors.New("CLI source changed")
	}
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(out, h), io.LimitReader(in, a.Bytes+1))
	syncErr, closeErr := out.Sync(), out.Close()
	if copyErr != nil || syncErr != nil || closeErr != nil || n != a.Bytes || hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
		return errors.New("staged CLI failed exact size, hash or durable write verification")
	}
	return nil
}
func writeInstallJSON(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var object any
	if err = json.Unmarshal(raw, &object); err != nil {
		return err
	}
	var data bytes.Buffer
	enc := json.NewEncoder(&data)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err = enc.Encode(object); err != nil {
		return err
	}
	return writeDownloadFile(path, &data)
}

type boundedVersionOutput struct{ bytes.Buffer }

func (b *boundedVersionOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4096 {
		return 0, errors.New("CLI version output exceeded limit")
	}
	return b.Buffer.Write(p)
}
func checkNativeCLI(ctx context.Context, path string, m ReleaseManifest) error {
	file, err := elf.Open(path)
	if err != nil {
		return errors.New("CLI artifact is not a native ELF executable")
	}
	valid := file.Machine == elf.EM_X86_64 && file.Class == elf.ELFCLASS64 && (file.Type == elf.ET_EXEC || file.Type == elf.ET_DYN)
	file.Close()
	if !valid {
		return errors.New("CLI executable platform is incompatible")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, path, "version", "--json")
	command.Env = []string{"VAULTIX_DISABLE_UPDATE_CHECK=1"}
	command.Stderr = io.Discard
	var output boundedVersionOutput
	command.Stdout = &output
	if command.Run() != nil {
		return errors.New("verified CLI did not pass native version check")
	}
	var value struct{ Product, Version, Revision, OS, Arch string }
	decoder := json.NewDecoder(&output)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || value.Product != "Vaultix CLI" || value.Version != m.Version || value.Revision != m.Revision || value.OS != "linux" || value.Arch != "amd64" {
		return errors.New("CLI reported identity differs from signed release")
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("CLI version response has extra content")
	}
	return nil
}
