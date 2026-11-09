package release

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsNativeIdentityAndCancellation(t *testing.T) {
	family, full, err := windowsPackageNames("CN=Vaultix Disposable Probe", 65536)
	if err != nil || !strings.HasPrefix(family, "Vaultix.CLI_") || !strings.HasPrefix(full, "Vaultix.CLI_0.0.1.0_x64__") {
		t.Fatal(family, full, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := deployWindowsPackage(ctx, `C:\does-not-exist.msix`); err != context.Canceled {
		t.Fatal("cancelled deployment attempted", err)
	}
	for _, seq := range []int64{0, -1, 9007199254740992} {
		if _, _, err := windowsPackageNames("CN=Fixture", seq); err == nil {
			t.Fatal("invalid sequence accepted")
		}
	}
}
func TestWindowsPrivateDirectoryAndLock(t *testing.T) {
	root := filepath.Join(t.TempDir(), "private")
	if err := createWindowsPrivateDirectory(root); err != nil {
		t.Fatal(err)
	}
	first, err := windowsInstallLock(root, true)
	if err != nil {
		t.Fatal(err)
	}
	if second, err := windowsInstallLock(root, false); err == nil {
		second.Close()
		t.Fatal("concurrent installer accepted")
	}
	first.Close()
	second, err := windowsInstallLock(root, false)
	if err != nil {
		t.Fatal(err)
	}
	second.Close()
	user, err := windowsInstallUser()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("O:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err = windows.SetNamedSecurityInfo(root, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		t.Fatal(err)
	}
	if err = privateWindowsPath(root, true); err == nil {
		t.Fatal("world-writable installer directory accepted")
	}
}
