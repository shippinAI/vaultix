package main

import (
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

var getCurrentPackagePath = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetCurrentPackagePath")

func commandArguments(args []string) []string {
	// Avoid OS queries for ordinary invocations. PowerShell can duplicate the
	// registered executable path on the first launch after deferred MSIX activation.
	if len(args) < 3 || !strings.EqualFold(args[0], args[1]) {
		return args[1:]
	}
	packagePath := currentPackagePath()
	if packagePath == "" {
		return args[1:]
	}
	executable, err := os.Executable()
	if err != nil {
		return args[1:]
	}
	localAppData, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return args[1:]
	}
	return packagedCommandArguments(args, executable, packagePath, localAppData)
}

func currentPackagePath() string {
	if err := getCurrentPackagePath.Find(); err != nil {
		return ""
	}
	var size uint32
	code, _, _ := getCurrentPackagePath.Call(uintptr(unsafe.Pointer(&size)), 0)
	if code != uintptr(windows.ERROR_INSUFFICIENT_BUFFER) || size < 2 || size > 32768 {
		return ""
	}
	buffer := make([]uint16, size)
	code, _, _ = getCurrentPackagePath.Call(uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&buffer[0])))
	if code != 0 || size < 2 || size > uint32(len(buffer)) || buffer[size-1] != 0 {
		return ""
	}
	return windows.UTF16ToString(buffer[:size])
}

// This corrects only the observed OS activation prefix. It never searches the
// command tail, retries a command, or interprets a user-supplied package path.
func packagedCommandArguments(args []string, executable, packagePath, localAppData string) []string {
	if len(args) < 3 || !strings.EqualFold(args[0], args[1]) ||
		!filepath.IsAbs(executable) || !filepath.IsAbs(packagePath) || !filepath.IsAbs(localAppData) {
		return args[1:]
	}
	name := filepath.Base(executable)
	if !strings.EqualFold(name, "vaultix.exe") && !strings.EqualFold(name, "vaultixl.exe") {
		return args[1:]
	}
	if !strings.EqualFold(executable, filepath.Join(packagePath, name)) ||
		!strings.EqualFold(args[0], filepath.Join(localAppData, "Microsoft", "WindowsApps", name)) {
		return args[1:]
	}
	return args[2:]
}
