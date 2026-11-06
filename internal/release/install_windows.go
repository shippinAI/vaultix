package release

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"golang.org/x/sys/windows"
)

type windowsInstallOwner struct {
	SchemaVersion string `json:"schemaVersion"`
	Platform      string `json:"platform"`
	TrustSHA256   string `json:"trustSha256"`
	Publisher     string `json:"publisher"`
	Family        string `json:"family"`
}
type windowsInstallState struct {
	SchemaVersion string `json:"schemaVersion"`
	Active        string `json:"active"`
	Pending       string `json:"pending"`
	Phase         string `json:"phase"`
}
type windowsGeneration struct {
	manifest   ReleaseManifest
	checkpoint ReleaseCheckpoint
	fullName   string
	directory  string
}
type windowsInstallation struct {
	root            string
	owner           windowsInstallOwner
	trust           []byte
	state           windowsInstallState
	active, pending *windowsGeneration
}

func readWindowsGeneration(root, key string, owner windowsInstallOwner, trust []byte) (*windowsGeneration, error) {
	if !digestPattern.MatchString(key) {
		return nil, errors.New("invalid Windows installation generation identifier")
	}
	dir := filepath.Join(root, "releases", key)
	if err := privateWindowsPath(dir, true); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 4 {
		return nil, errors.New("unexpected Windows generation contents")
	}
	acceptedRaw, err := readWindowsInstallMetadata(filepath.Join(dir, "accepted.json"), 4096)
	if err != nil {
		return nil, err
	}
	var accepted cliAccepted
	if decodeCanonical(acceptedRaw, 4096, &accepted) != nil || accepted.SchemaVersion != "vaultix.cli-acceptance.v1" || accepted.Checkpoint.SHA256 != key {
		return nil, errors.New("invalid Windows acceptance record")
	}
	at, err := parseReleaseTime(accepted.AcceptedAt)
	if err != nil || at.After(time.Now().Add(5*time.Minute)) {
		return nil, errors.New("invalid Windows acceptance time")
	}
	raw, err := readWindowsInstallMetadata(filepath.Join(dir, "release-manifest.json"), 65536)
	if err != nil {
		return nil, err
	}
	signed, err := readWindowsInstallMetadata(filepath.Join(dir, "release-signature.json"), 4096)
	if err != nil {
		return nil, err
	}
	m, cp, err := VerifyRelease(raw, signed, trust, at, nil)
	if err != nil {
		return nil, err
	}
	if cp != accepted.Checkpoint {
		return nil, errors.New("Windows checkpoint differs from signed release")
	}
	a, err := windowsMSIXArtifact(m)
	if err != nil {
		return nil, err
	}
	packagePath := filepath.Join(dir, a.Name)
	if err = privateWindowsPath(packagePath, false); err != nil {
		return nil, err
	}
	publisher, err := validateWindowsPackage(packagePath, m)
	if err != nil {
		return nil, err
	}
	if publisher != owner.Publisher {
		return nil, errors.New("Windows package publisher changed")
	}
	family, full, err := windowsPackageNames(publisher, m.Sequence)
	if err != nil {
		return nil, err
	}
	if family != owner.Family {
		return nil, errors.New("Windows package family changed")
	}
	return &windowsGeneration{m, cp, full, dir}, nil
}
func loadWindowsInstallation(root, suppliedTrust string) (*windowsInstallation, error) {
	if err := privateWindowsPath(root, true); err != nil {
		return nil, err
	}
	raw, err := readWindowsInstallMetadata(filepath.Join(root, "owner.json"), 16384)
	if err != nil {
		return nil, errors.New("directory is not a managed Windows CLI installation; existing files are not adopted")
	}
	w := &windowsInstallation{root: root}
	if decodeCanonical(raw, 16384, &w.owner) != nil || w.owner.SchemaVersion != "vaultix.cli-windows-owner.v1" || w.owner.Platform != "windows/amd64" {
		return nil, errors.New("unsupported Windows installation owner")
	}
	w.trust, err = readWindowsInstallMetadata(filepath.Join(root, "trust.json"), 16384)
	if err != nil || hashBytes(w.trust) != w.owner.TrustSHA256 {
		return nil, errors.New("Windows installation trust changed")
	}
	if suppliedTrust != "" {
		provided, e := ReadReleaseMetadata(suppliedTrust, 16384)
		if e != nil || !bytes.Equal(provided, w.trust) {
			return nil, errors.New("updates cannot replace pinned installation trust")
		}
	}
	raw, err = readWindowsInstallMetadata(filepath.Join(root, "state.json"), 4096)
	if err != nil {
		return nil, err
	}
	if decodeCanonical(raw, 4096, &w.state) != nil || w.state.SchemaVersion != "vaultix.cli-windows-state.v1" || (w.state.Active == "" && w.state.Pending == "") || (w.state.Active != "" && w.state.Active == w.state.Pending) || (w.state.Pending == "" && w.state.Phase != "active") || (w.state.Pending != "" && w.state.Phase != "prepared" && w.state.Phase != "pending-activation") {
		return nil, errors.New("invalid Windows installation state")
	}
	if err = privateWindowsPath(filepath.Join(root, "releases"), true); err != nil {
		return nil, err
	}
	if w.state.Active != "" {
		w.active, err = readWindowsGeneration(root, w.state.Active, w.owner, w.trust)
		if err != nil {
			return nil, err
		}
	}
	if w.state.Pending != "" {
		w.pending, err = readWindowsGeneration(root, w.state.Pending, w.owner, w.trust)
		if err != nil {
			return nil, err
		}
		if w.active != nil {
			next, _ := Parse(w.pending.manifest.Version)
			old, _ := Parse(w.active.manifest.Version)
			if w.pending.checkpoint.Sequence <= w.active.checkpoint.Sequence || Compare(next, old) <= 0 {
				return nil, errors.New("pending Windows release does not advance the active release")
			}
		}
	}
	if err = w.reconcile(); err != nil {
		return nil, err
	}
	return w, nil
}
func verifyRegisteredWindowsGeneration(path string, generation *windowsGeneration) error {
	if err := realWindowsPath(path); err != nil {
		return err
	}
	for _, name := range []string{"vaultix", "vaultixl"} {
		a, err := windowsCLIArtifact(generation.manifest, name)
		if err != nil {
			return err
		}
		a.Name = name + ".exe"
		if err = realWindowsPath(filepath.Join(path, a.Name)); err != nil {
			return err
		}
		if err = verifyReleaseFile(path, a); err != nil {
			return err
		}
	}
	raw, err := ReadReleaseMetadata(filepath.Join(path, "AppxManifest.xml"), 65536)
	if err != nil {
		return err
	}
	_, err = validatePackageManifest(raw, generation.manifest.Sequence)
	return err
}
func (w *windowsInstallation) reconcile() error {
	full, path, err := registeredWindowsPackage(w.owner.Family)
	if err != nil {
		return err
	}
	if w.pending != nil && full == w.pending.fullName {
		if err = verifyRegisteredWindowsGeneration(path, w.pending); err != nil {
			return err
		}
		next := windowsInstallState{"vaultix.cli-windows-state.v1", w.state.Pending, "", "active"}
		if err = replaceWindowsInstallJSON(w.root, "state.json", next); err != nil {
			return errors.New("package activated but checkpoint reconciliation failed; retry update status")
		}
		w.state = next
		w.active = w.pending
		w.pending = nil
		return nil
	}
	if w.active != nil && full == w.active.fullName {
		return verifyRegisteredWindowsGeneration(path, w.active)
	}
	if w.active == nil && full == "" {
		return nil
	}
	return errors.New("registered Windows package does not match the managed active or pending release; refusing adoption")
}
func (w *windowsInstallation) result(changed bool) (CLIInstallResult, error) {
	target := w.pending
	state := w.state.Phase
	if target == nil {
		target = w.active
		state = "active"
	}
	if target == nil {
		return CLIInstallResult{}, errors.New("Windows installation has no target")
	}
	local, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return CLIInstallResult{}, err
	}
	win := &CLIWindowsInstallation{State: state, Publisher: w.owner.Publisher, PackageFamily: w.owner.Family, PackageFullName: target.fullName}
	if w.active != nil {
		win.Active = &CLIWindowsActive{w.active.manifest.Version, w.active.manifest.Revision, w.active.fullName, w.active.checkpoint}
	}
	return CLIInstallResult{SchemaVersion: "vaultix.cli-install-result.v2", Directory: w.root, BinDirectory: filepath.Join(local, "Microsoft", "WindowsApps"), Version: target.manifest.Version, Revision: target.manifest.Revision, Platform: "windows/amd64", Checkpoint: target.checkpoint, Changed: changed, Verified: w.pending == nil, Windows: win}, nil
}
func windowsCLIInstallation(directory string) (CLIInstallResult, error) {
	root, err := windowsInstallRoot(directory, false)
	if err != nil {
		return CLIInstallResult{}, err
	}
	if err = privateWindowsPath(root, true); err != nil {
		return CLIInstallResult{}, err
	}
	lock, err := windowsInstallLock(root, false)
	if err != nil {
		return CLIInstallResult{}, err
	}
	defer lock.Close()
	w, err := loadWindowsInstallation(root, "")
	if err != nil {
		return CLIInstallResult{}, err
	}
	return w.result(false)
}
func ensureWindowsCommandsUnowned(family string) error {
	full, _, err := registeredWindowsPackage(family)
	if err != nil {
		return err
	}
	if full != "" {
		return errors.New("an unmanaged Windows CLI package is already registered")
	}
	local, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return err
	}
	for _, name := range []string{"vaultix.exe", "vaultixl.exe"} {
		_, err = os.Lstat(filepath.Join(local, "Microsoft", "WindowsApps", name))
		if !errors.Is(err, os.ErrNotExist) {
			return errors.New("a Windows command registration already owns " + name)
		}
	}
	return nil
}
func installWindowsCLI(ctx context.Context, o CLIInstallOptions) (CLIInstallResult, error) {
	var zero CLIInstallResult
	if runtime.GOARCH != "amd64" {
		return zero, errors.New("Windows installation currently supports amd64 only")
	}
	if (o.Bundle == "") == (o.Version == "") {
		return zero, errors.New("select one release bundle or exact version")
	}
	root, err := windowsInstallRoot(o.Directory, true)
	if err != nil {
		return zero, err
	}
	_, err = os.Lstat(root)
	fresh := errors.Is(err, os.ErrNotExist)
	if err != nil && !fresh {
		return zero, err
	}
	work := root
	if fresh {
		if o.Trust == "" {
			return zero, errors.New("first installation requires preprovisioned release trust")
		}
		work, err = os.MkdirTemp(filepath.Dir(root), ".cli-install-")
		if err != nil {
			return zero, err
		}
		defer func() {
			if work != root {
				_ = os.RemoveAll(work)
			}
		}()
	}
	if err = privateWindowsPath(work, true); err != nil {
		return zero, err
	}
	lock, err := windowsInstallLock(work, fresh)
	if err != nil {
		return zero, err
	}
	defer func() {
		if lock != nil {
			_ = lock.Close()
		}
	}()
	var w *windowsInstallation
	if fresh {
		trust, e := ReadReleaseMetadata(o.Trust, 16384)
		if e != nil {
			return zero, e
		}
		w = &windowsInstallation{root: work, trust: trust, state: windowsInstallState{SchemaVersion: "vaultix.cli-windows-state.v1"}}
	} else {
		w, err = loadWindowsInstallation(root, o.Trust)
		if err != nil {
			return zero, err
		}
	}
	var prior *ReleaseCheckpoint
	if w.pending != nil {
		prior = &w.pending.checkpoint
	} else if w.active != nil {
		prior = &w.active.checkpoint
	}
	acquired := ""
	if o.Bundle == "" {
		download, e := os.MkdirTemp(work, ".acquire-")
		if e != nil {
			return zero, e
		}
		acquired = download
		defer func() { _ = os.RemoveAll(download) }()
		if e = privateWindowsPath(download, true); e != nil {
			return zero, e
		}
		trustPath := filepath.Join(download, "trust.json")
		if e = writeDownloadFile(trustPath, bytes.NewReader(w.trust)); e != nil {
			return zero, e
		}
		checkpointPath := ""
		if prior != nil {
			checkpointPath = filepath.Join(download, "checkpoint.json")
			if e = writeInstallJSON(checkpointPath, prior); e != nil {
				return zero, e
			}
		}
		o.Bundle = filepath.Join(download, "bundle")
		if _, e = Download(ctx, DownloadOptions{Version: o.Version, Directory: o.Bundle, Trust: trustPath, Checkpoint: checkpointPath, Preview: o.Preview, Progress: o.Progress}); e != nil {
			return zero, e
		}
	}
	raw, err := ReadReleaseMetadata(filepath.Join(o.Bundle, "release-manifest.json"), 65536)
	if err != nil {
		return zero, err
	}
	signed, err := ReadReleaseMetadata(filepath.Join(o.Bundle, "release-signature.json"), 4096)
	if err != nil {
		return zero, err
	}
	m, cp, err := VerifyRelease(raw, signed, w.trust, time.Now(), prior)
	if err != nil {
		return zero, err
	}
	if o.Version != "" && o.Version != m.Version {
		return zero, errors.New("release does not match requested version")
	}
	if (m.Channel == "preview") != o.Preview {
		return zero, errors.New("preview installation requires explicit --preview")
	}
	if w.pending != nil && cp != w.pending.checkpoint {
		return zero, errors.New("a Windows update is already pending; complete or retry that release first")
	}
	if w.active != nil && cp == w.active.checkpoint {
		return w.result(false)
	}
	if w.active != nil {
		next, _ := Parse(m.Version)
		old, _ := Parse(w.active.manifest.Version)
		if Compare(next, old) <= 0 {
			return zero, errors.New("CLI downgrade or replacement of an accepted version is refused")
		}
	}
	if err = VerifyReleaseArtifacts(m, o.Bundle); err != nil {
		return zero, err
	}
	a, err := windowsMSIXArtifact(m)
	if err != nil {
		return zero, err
	}
	if w.pending == nil {
		generation, e := os.MkdirTemp(work, ".generation-")
		if e != nil {
			return zero, e
		}
		defer os.RemoveAll(generation)
		if e = privateWindowsPath(generation, true); e != nil {
			return zero, e
		}
		if e = copyCLIArtifact(filepath.Join(o.Bundle, a.Name), filepath.Join(generation, a.Name), a); e != nil {
			return zero, e
		}
		publisher, e := validateWindowsPackage(filepath.Join(generation, a.Name), m)
		if e != nil {
			return zero, e
		}
		if e = checkWindowsNativeCLI(ctx, filepath.Join(generation, a.Name), m); e != nil {
			return zero, e
		}
		family, _, e := windowsPackageNames(publisher, m.Sequence)
		if e != nil {
			return zero, e
		}
		if fresh {
			if e = ensureWindowsCommandsUnowned(family); e != nil {
				return zero, e
			}
			w.owner = windowsInstallOwner{"vaultix.cli-windows-owner.v1", "windows/amd64", hashBytes(w.trust), publisher, family}
			if e = createWindowsPrivateDirectory(filepath.Join(work, "releases")); e != nil {
				return zero, e
			}
			if e = writeInstallJSON(filepath.Join(work, "owner.json"), w.owner); e != nil {
				return zero, e
			}
			if e = writeDownloadFile(filepath.Join(work, "trust.json"), bytes.NewReader(w.trust)); e != nil {
				return zero, e
			}
		} else if publisher != w.owner.Publisher || family != w.owner.Family {
			return zero, errors.New("updates cannot change the pinned Windows package publisher")
		}
		for name, value := range map[string][]byte{"release-manifest.json": raw, "release-signature.json": signed} {
			if e = writeDownloadFile(filepath.Join(generation, name), bytes.NewReader(value)); e != nil {
				return zero, e
			}
		}
		if e = writeInstallJSON(filepath.Join(generation, "accepted.json"), cliAccepted{"vaultix.cli-acceptance.v1", time.Now().UTC().Format(time.RFC3339), cp}); e != nil {
			return zero, e
		}
		target := filepath.Join(work, "releases", cp.SHA256)
		// A crash may have published an immutable generation before recording
		// its intent. Reuse only after full independent validation below.
		if _, e = os.Lstat(target); errors.Is(e, os.ErrNotExist) {
			e = publishDownload(generation, target)
		}
		if e != nil {
			return zero, e
		}
		pending, e := readWindowsGeneration(work, cp.SHA256, w.owner, w.trust)
		if e != nil {
			return zero, e
		}
		if pending.checkpoint != cp {
			return zero, errors.New("prepared Windows generation differs from selected release")
		}
		if _, _, e = VerifyRelease(raw, signed, w.trust, time.Now(), prior); e != nil {
			return zero, e
		}
		if e = ctx.Err(); e != nil {
			return zero, e
		}
		w.state.Pending = cp.SHA256
		w.state.Phase = "prepared"
		if e = replaceWindowsInstallJSON(work, "state.json", w.state); e != nil {
			return zero, e
		}
		w.pending = pending
	}
	if fresh {
		if acquired != "" {
			if err = os.RemoveAll(acquired); err != nil {
				return zero, errors.New("cannot remove temporary acquisition before publication")
			}
		}
		// Close the staging lock before renaming its directory. No OS deployment
		// has begun. Destination publication refuses any competing installation.
		if err = lock.Close(); err != nil {
			return zero, err
		}
		lock = nil
		if err = publishDownload(work, root); err != nil {
			return zero, errors.New("installation publication failed; inspect update status before retry")
		}
		work = root
		lock, err = windowsInstallLock(root, false)
		if err != nil {
			return zero, err
		}
		w, err = loadWindowsInstallation(root, o.Trust)
		if err != nil {
			return zero, err
		}
	}
	if w.pending == nil {
		return w.result(false)
	}
	// The durable prepared record precedes the non-transactional OS request.
	// Never discard it on an error: Windows may have completed activation.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	if err = deployWindowsPackage(ctx, filepath.Join(w.pending.directory, a.Name)); err != nil {
		return zero, fmt.Errorf("%w; prepared release retained for update status or same-release retry", err)
	}
	if err = w.reconcile(); err != nil {
		return zero, err
	}
	if w.pending != nil {
		w.state.Phase = "pending-activation"
		if err = replaceWindowsInstallJSON(w.root, "state.json", w.state); err != nil {
			return zero, errors.New("Windows accepted deployment but recording deferred state failed; inspect update status")
		}
	}
	return w.result(true)
}
