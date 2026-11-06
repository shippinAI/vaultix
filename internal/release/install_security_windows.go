package release

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

func windowsInstallUser() (string, error) {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return "", err
	}
	return u.User.Sid.String(), nil
}
func trustedInstallSID(sid *windows.SID, user string) bool {
	if sid == nil || !sid.IsValid() {
		return false
	}
	s := sid.String()
	return s == user || s == "S-1-5-18" || s == "S-1-5-32-544"
}
func privateWindowsACL(path string) error {
	user, err := windowsInstallUser()
	if err != nil {
		return err
	}
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
	if err != nil || sd == nil {
		return errors.New("cannot inspect installation owner and DACL")
	}
	owner, _, err := sd.Owner()
	if err != nil || !trustedInstallSID(owner, user) {
		return errors.New("installation path is owned by another principal")
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil {
		return errors.New("installation path requires an explicit restrictive DACL")
	}
	const fileDeleteChild = 0x40 // winnt.h FILE_DELETE_CHILD (not exported by x/sys).
	const writes = windows.GENERIC_ALL | windows.GENERIC_WRITE | windows.WRITE_DAC | windows.WRITE_OWNER | windows.DELETE | windows.FILE_WRITE_DATA | windows.FILE_APPEND_DATA | windows.FILE_WRITE_EA | windows.FILE_WRITE_ATTRIBUTES | fileDeleteChild
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, i, &ace) != nil || ace == nil {
			return errors.New("cannot inspect installation ACE")
		}
		// Also reject foreign write grants marked inherit-only: this directory
		// will contain trust and transaction files created by this installer.
		switch ace.Header.AceType {
		case windows.ACCESS_DENIED_ACE_TYPE: // Ignoring a deny cannot grant access.
		case windows.ACCESS_ALLOWED_ACE_TYPE:
			if ace.Mask&writes != 0 && !trustedInstallSID((*windows.SID)(unsafe.Pointer(&ace.SidStart)), user) {
				return errors.New("installation path grants write access to another principal")
			}
		default:
			return errors.New("installation path uses an unsupported access-control entry")
		}
	}
	return nil
}

// Reject reparse traversal on the whole local path, not just the final file.
// Ancestors such as C:\ have OS-managed ACLs; private ACL enforcement applies
// to the canonical Vaultix parent and all installer-owned descendants.
func realWindowsPath(path string) error {
	if !filepath.IsAbs(path) || len(filepath.VolumeName(path)) != 2 || strings.Contains(path[2:], ":") {
		return errors.New("installation requires a local drive path")
	}
	for p := filepath.Clean(path); ; p = filepath.Dir(p) {
		name, err := windows.UTF16PtrFromString(p)
		if err != nil {
			return err
		}
		attrs, err := windows.GetFileAttributes(name)
		if err != nil || attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
			return errors.New("installation paths cannot traverse reparse points or missing directories")
		}
		if filepath.Dir(p) == p {
			break
		}
	}
	return nil
}
func privateWindowsPath(path string, directory bool) error {
	if err := realWindowsPath(path); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || (directory && !info.IsDir()) || (!directory && !info.Mode().IsRegular()) {
		return errors.New("unexpected installation path type")
	}
	return privateWindowsACL(path)
}
func createWindowsPrivateDirectory(path string) error {
	user, err := windowsInstallUser()
	if err != nil {
		return err
	}
	sd, err := windows.SecurityDescriptorFromString("O:" + user + "D:P(A;OICI;FA;;;" + user + ")(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)")
	if err != nil {
		return err
	}
	sa := windows.SecurityAttributes{SecurityDescriptor: sd}
	sa.Length = uint32(unsafe.Sizeof(sa))
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	if err = windows.CreateDirectory(name, &sa); err != nil && !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return err
	}
	return privateWindowsPath(path, true)
}
func windowsInstallRoot(requested string, createParent bool) (string, error) {
	roaming, err := windows.KnownFolderPath(windows.FOLDERID_RoamingAppData, 0)
	if err != nil {
		return "", errors.New("cannot determine the current user's application directory")
	}
	parent := filepath.Join(roaming, "vaultix")
	root := filepath.Join(parent, "cli-install")
	if requested != "" {
		abs, err := filepath.Abs(requested)
		if err != nil || !strings.EqualFold(abs, root) {
			return "", errors.New("Windows uses the per-user Vaultix application directory; omit --directory or use " + root)
		}
	}
	if err = realWindowsPath(roaming); err != nil {
		return "", err
	}
	if createParent {
		err = createWindowsPrivateDirectory(parent)
	} else {
		err = privateWindowsPath(parent, true)
	}
	if err != nil {
		return "", err
	}
	return root, nil
}
func windowsInstallLock(root string, create bool) (*os.File, error) {
	path := filepath.Join(root, ".install.lock")
	if _, err := os.Lstat(path); err == nil {
		if err = privateWindowsPath(path, false); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	disposition := uint32(windows.OPEN_EXISTING)
	if create {
		disposition = windows.CREATE_NEW
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, 0, nil, disposition, windows.FILE_ATTRIBUTE_NORMAL|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, errors.New("another CLI installation operation is active or the lock is inaccessible")
	}
	f := os.NewFile(uintptr(h), path)
	var info windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(h, &info) != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.NumberOfLinks != 1 || privateWindowsACL(path) != nil {
		f.Close()
		return nil, errors.New("installation lock is not a private regular file")
	}
	return f, nil
}
func readWindowsInstallMetadata(path string, limit int64) ([]byte, error) {
	if err := privateWindowsPath(path, false); err != nil {
		return nil, err
	}
	return ReadReleaseMetadata(path, limit)
}
func replaceWindowsInstallJSON(root, name string, value any) error {
	temp, err := os.MkdirTemp(root, ".state-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	if err = privateWindowsPath(temp, true); err != nil {
		return err
	}
	stage := filepath.Join(temp, name)
	if err = writeInstallJSON(stage, value); err != nil {
		return err
	}
	target := filepath.Join(root, name)
	if _, err = os.Lstat(target); err == nil {
		if err = privateWindowsPath(target, false); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	from, _ := windows.UTF16PtrFromString(stage)
	to, _ := windows.UTF16PtrFromString(target)
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
