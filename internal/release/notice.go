package release

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func Disabled() bool {
	value := strings.ToLower(os.Getenv("VAULTIX_DISABLE_UPDATE_CHECK"))
	return value == "true" || value == "1"
}

func Notify(ctx context.Context, version string, args []string, out *os.File) {
	if Disabled() || len(args) == 0 {
		return
	}
	eligible := args[0] == "login" || args[0] == "init" || (len(args) == 2 && args[0] == "auth" && args[1] == "status")
	if !eligible {
		return
	}
	for _, arg := range args {
		if arg == "--help" || arg == "-h" || arg == "--token" || arg == "--universal" {
			return
		}
	}
	info, err := out.Stat()
	if err != nil || info.Mode()&os.ModeCharDevice == 0 {
		return
	}
	if _, valid := Parse(version); !valid {
		return
	}
	dir, err := os.UserCacheDir()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	notify(ctx, version, out, filepath.Join(dir, "vaultix", "update-status.json"), NewClient(), time.Now())
}

type noticeCache struct {
	CheckedAt time.Time `json:"checkedAt"`
	Status    Status    `json:"status"`
}

func notify(ctx context.Context, version string, out io.Writer, path string, client Client, now time.Time) {
	var cached noticeCache
	if file, err := os.Open(path); err == nil {
		data, readErr := io.ReadAll(io.LimitReader(file, 4097))
		_ = file.Close()
		if readErr == nil && len(data) <= 4096 {
			_ = json.Unmarshal(data, &cached)
		}
	}
	age := now.Sub(cached.CheckedAt)
	if cached.Status.CurrentVersion != version || cached.CheckedAt.IsZero() || age < 0 || age > 24*time.Hour {
		status, _ := client.Check(ctx, version)
		cached = noticeCache{CheckedAt: now, Status: status}
		if os.MkdirAll(filepath.Dir(path), 0700) == nil {
			if file, err := os.CreateTemp(filepath.Dir(path), ".update-*"); err == nil {
				name := file.Name()
				defer os.Remove(name)
				if json.NewEncoder(file).Encode(cached) == nil && file.Close() == nil {
					_ = os.Rename(name, path)
				} else {
					_ = file.Close()
				}
			}
		}
	}
	latest, valid := Parse(cached.Status.LatestVersion)
	current, installed := Parse(version)
	if cached.Status.State != "available" || !valid || !installed || strings.TrimSpace(cached.Status.LatestVersion) != cached.Status.LatestVersion || len(latest.pre) > 0 || Compare(latest, current) <= 0 {
		return
	}
	_, _ = fmt.Fprintf(out, "Vaultix CLI update available: %s → %s. Run vaultix update check for release details.\n", version, cached.Status.LatestVersion)
}
