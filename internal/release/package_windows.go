package release

// Native per-user MSIX deployment. The ABI follows Windows SDK 10.0.26100.0:
// windows.management.deployment.h, windows.foundation.h, asyncinfo.h and
// appmodel.h. No PowerShell subprocess or force-close deployment option is used.
import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var winRT = windows.NewLazySystemDLL("combase.dll")
var winCreateString = winRT.NewProc("WindowsCreateString")
var winDeleteString = winRT.NewProc("WindowsDeleteString")
var winInitialize = winRT.NewProc("RoInitialize")
var winUninitialize = winRT.NewProc("RoUninitialize")
var winActivate = winRT.NewProc("RoActivateInstance")
var winFactory = winRT.NewProc("RoGetActivationFactory")
var packageKernel = windows.NewLazySystemDLL("kernel32.dll")

type winObject struct{ table *[40]uintptr }

func winHRESULT(hr uintptr, operation string) error {
	if int32(hr) < 0 {
		return fmt.Errorf("%s failed (HRESULT 0x%08x)", operation, uint32(hr))
	}
	return nil
}

//go:uintptrescapes
func (o *winObject) call(slot int, args ...uintptr) error {
	if o == nil || o.table == nil || slot < 0 || slot >= len(o.table) || o.table[slot] == 0 {
		return errors.New("Windows returned an unavailable package interface")
	}
	a := append([]uintptr{uintptr(unsafe.Pointer(o))}, args...)
	hr, _, _ := syscall.SyscallN(o.table[slot], a...)
	runtime.KeepAlive(o)
	return winHRESULT(hr, "Windows package operation")
}
func (o *winObject) release() {
	if o != nil {
		_, _, _ = syscall.SyscallN(o.table[2], uintptr(unsafe.Pointer(o)))
	}
}
func (o *winObject) query(id string) (*winObject, error) {
	iid, err := windows.GUIDFromString(id)
	if err != nil {
		return nil, err
	}
	var out *winObject
	err = o.call(0, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&out)))
	runtime.KeepAlive(iid)
	return out, err
}
func winString(value string) (uintptr, error) {
	utf, err := windows.UTF16FromString(value)
	if err != nil {
		return 0, err
	}
	var handle uintptr
	hr, _, _ := winCreateString.Call(uintptr(unsafe.Pointer(&utf[0])), uintptr(len(utf)-1), uintptr(unsafe.Pointer(&handle)))
	runtime.KeepAlive(utf)
	return handle, winHRESULT(hr, "WindowsCreateString")
}
func winInstance(name string) (*winObject, error) {
	h, err := winString(name)
	if err != nil {
		return nil, err
	}
	defer winDeleteString.Call(h)
	var out *winObject
	hr, _, _ := winActivate.Call(h, uintptr(unsafe.Pointer(&out)))
	return out, winHRESULT(hr, "RoActivateInstance")
}
func winPackageURI(path string) (*winObject, error) {
	if !filepath.IsAbs(path) || len(filepath.VolumeName(path)) != 2 {
		return nil, errors.New("package deployment requires a local absolute path")
	}
	name, err := winString("Windows.Foundation.Uri")
	if err != nil {
		return nil, err
	}
	defer winDeleteString.Call(name)
	iid, _ := windows.GUIDFromString("{44a9796f-723e-4fdf-a218-033e75b0c084}")
	var factory *winObject
	hr, _, _ := winFactory.Call(name, uintptr(unsafe.Pointer(&iid)), uintptr(unsafe.Pointer(&factory)))
	if err = winHRESULT(hr, "RoGetActivationFactory"); err != nil {
		return nil, err
	}
	defer factory.release()
	// URL escaping is necessary for user profile names containing #, %, spaces,
	// or non-ASCII text; concatenating an unescaped file URI is incorrect.
	address := (&url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(path)}).String()
	h, err := winString(address)
	if err != nil {
		return nil, err
	}
	defer winDeleteString.Call(h)
	var out *winObject
	err = factory.call(6, h, uintptr(unsafe.Pointer(&out)))
	return out, err
}

func deployWindowsPackage(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	hr, _, _ := winInitialize.Call(1) // RO_INIT_MULTITHREADED
	if err := winHRESULT(hr, "RoInitialize"); err != nil {
		return err
	}
	defer winUninitialize.Call()
	manager, err := winInstance("Windows.Management.Deployment.PackageManager")
	if err != nil {
		return err
	}
	defer manager.release()
	pm, err := manager.query("{1aa79035-cc71-4b2e-80a6-c7041d8579a7}")
	if err != nil {
		return err
	}
	defer pm.release()
	value, err := winInstance("Windows.Management.Deployment.AddPackageOptions")
	if err != nil {
		return err
	}
	defer value.release()
	options, err := value.query("{05cee018-f68f-422b-95a4-66679ec77fc0}")
	if err != nil {
		return err
	}
	defer options.release()
	// IAddPackageOptions.put_DeferRegistrationWhenPackagesAreInUse. Leave
	// AllowUnsigned and all force-shutdown/force-downgrade options at false.
	if err = options.call(35, 1); err != nil {
		return err
	}
	address, err := winPackageURI(path)
	if err != nil {
		return err
	}
	defer address.release()
	var op *winObject
	if err = pm.call(7, uintptr(unsafe.Pointer(address)), uintptr(unsafe.Pointer(options)), uintptr(unsafe.Pointer(&op))); err != nil {
		return err
	}
	defer op.release()
	info, err := op.query("{00000036-0000-0000-C000-000000000046}")
	if err != nil {
		return err
	}
	defer info.release()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		var state uint32
		if err = info.call(7, uintptr(unsafe.Pointer(&state))); err != nil {
			return err
		}
		if state != 0 {
			defer info.call(10) // Close only a terminal IAsyncInfo operation.
			if state != 1 {
				var code int32
				_ = info.call(8, uintptr(unsafe.Pointer(&code)))
				return fmt.Errorf("Windows deployment status %d (HRESULT 0x%08x); inspect update status before retry", state, uint32(code))
			}
			var result *winObject
			if err = op.call(10, uintptr(unsafe.Pointer(&result))); err != nil {
				return err
			}
			defer result.release()
			var code int32
			if err = result.call(8, uintptr(unsafe.Pointer(&code))); err != nil {
				return err
			}
			return winHRESULT(uintptr(uint32(code)), "Windows package deployment")
		}
		select {
		case <-ctx.Done():
			_ = info.call(9) // Cancellation is a request, not proof of rollback.
			return errors.New("Windows deployment cancelled; activation may still complete; inspect update status before retry")
		case <-ticker.C:
		}
	}
}

type windowsPackageID struct {
	Reserved, Architecture                   uint32
	Version                                  uint64
	Name, Publisher, ResourceID, PublisherID *uint16
}

func windowsPackageNames(publisher string, sequence int64) (family, full string, err error) {
	if sequence <= 0 || sequence > 9007199254740991 || publisher == "" || len(publisher) > 8192 {
		return "", "", errors.New("invalid Windows package identity")
	}
	name, _ := windows.UTF16PtrFromString("Vaultix.CLI")
	pub, err := windows.UTF16PtrFromString(publisher)
	if err != nil {
		return "", "", err
	}
	empty, _ := windows.UTF16PtrFromString("")
	id := windowsPackageID{Architecture: 9, Version: uint64(sequence), Name: name, Publisher: pub, ResourceID: empty}
	for _, item := range []struct {
		api    string
		target *string
	}{{"PackageFamilyNameFromId", &family}, {"PackageFullNameFromId", &full}} {
		proc := packageKernel.NewProc(item.api)
		var size uint32
		rc, _, _ := proc.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&size)), 0)
		if rc != 122 || size < 2 || size > 1024 {
			return "", "", fmt.Errorf("%s size query failed (%d)", item.api, rc)
		}
		buffer := make([]uint16, size)
		rc, _, _ = proc.Call(uintptr(unsafe.Pointer(&id)), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&buffer[0])))
		if rc != 0 || size > uint32(len(buffer)) || size < 2 || buffer[size-1] != 0 {
			return "", "", errors.New("invalid Windows package identity response")
		}
		*item.target = windows.UTF16ToString(buffer[:size])
	}
	runtime.KeepAlive(id)
	return family, full, nil
}

func registeredWindowsPackage(family string) (full, path string, err error) {
	name, err := windows.UTF16PtrFromString(family)
	if err != nil {
		return "", "", err
	}
	api := packageKernel.NewProc("FindPackagesByPackageFamily")
	var count, size uint32
	rc, _, _ := api.Call(uintptr(unsafe.Pointer(name)), 0x10, uintptr(unsafe.Pointer(&count)), 0, uintptr(unsafe.Pointer(&size)), 0, 0)
	if rc == 0 && count == 0 {
		return "", "", nil
	}
	// Exactly one registered HEAD package is acceptable. A changing registration
	// produces an explicit retry error, not a guessed or partially read state.
	if rc != 122 || count != 1 || size < 2 || size > 32768 {
		return "", "", errors.New("cannot determine a unique registered CLI package")
	}
	buffer := make([]uint16, size)
	var pointer *uint16
	var properties uint32
	rc, _, _ = api.Call(uintptr(unsafe.Pointer(name)), 0x10, uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&pointer)), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&properties)))
	if rc != 0 || count != 1 || size > uint32(len(buffer)) {
		return "", "", errors.New("CLI registration changed during query; retry status")
	}
	base, ptr := uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(pointer))
	if ptr < base || ptr >= base+uintptr(len(buffer))*2 || (ptr-base)%2 != 0 {
		return "", "", errors.New("invalid registered package name pointer")
	}
	start := int((ptr - base) / 2)
	end := start
	for end < len(buffer) && buffer[end] != 0 {
		end++
	}
	if end == len(buffer) || end == start {
		return "", "", errors.New("invalid registered package name")
	}
	full = windows.UTF16ToString(buffer[start:end])
	runtime.KeepAlive(buffer)
	f, _ := windows.UTF16PtrFromString(full)
	api = packageKernel.NewProc("GetPackagePathByFullName")
	size = 0
	rc, _, _ = api.Call(uintptr(unsafe.Pointer(f)), uintptr(unsafe.Pointer(&size)), 0)
	if rc != 122 || size < 4 || size > 32768 {
		return "", "", errors.New("cannot locate registered package")
	}
	buffer = make([]uint16, size)
	rc, _, _ = api.Call(uintptr(unsafe.Pointer(f)), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&buffer[0])))
	if rc != 0 || size > uint32(len(buffer)) || size < 4 || buffer[size-1] != 0 {
		return "", "", errors.New("invalid registered package path")
	}
	path = windows.UTF16ToString(buffer[:size])
	if !filepath.IsAbs(path) || len(filepath.VolumeName(path)) != 2 || strings.Contains(path, "\x00") {
		return "", "", errors.New("registered package is not local")
	}
	return full, path, nil
}
