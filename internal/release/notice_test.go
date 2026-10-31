package release

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNoticeCacheAndProtocolSeparation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update.json")
	now := time.Now()
	calls := 0
	client := NewClient()
	client.HTTP.Transport = roundTrip(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"tag_name":"v2.0.0","draft":false,"prerelease":false,"published_at":"2026-10-31T12:00:00Z"}`))}, nil
	})
	var output bytes.Buffer
	notify(context.Background(), "1.0.0", &output, path, client, now)
	if calls != 1 || !strings.Contains(output.String(), "update available") {
		t.Fatal("missing update notice")
	}
	output.Reset()
	notify(context.Background(), "1.0.0", &output, path, client, now.Add(time.Hour))
	if calls != 1 || !strings.Contains(output.String(), "update available") {
		t.Fatal("cache did not prevent repeated request")
	}
	output.Reset()
	notify(context.Background(), "2.0.0", &output, path, client, now.Add(2*time.Hour))
	if calls != 2 || output.Len() != 0 {
		t.Fatal("stale update notice survived installed-version change")
	}
	file, err := os.CreateTemp(t.TempDir(), "protocol")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	for _, args := range [][]string{{"mcp"}, {"version", "--json"}, {"run", "--offline", "--", "app"}, {"update", "check", "--json"}} {
		Notify(context.Background(), "1.0.0", args, file)
	}
	info, _ := file.Stat()
	if info.Size() != 0 {
		t.Fatal("notification contaminated machine output")
	}
}

func TestNoticeRejectsForgedCachedVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "update.json")
	now := time.Now()
	data, _ := json.Marshal(noticeCache{CheckedAt: now, Status: Status{State: "available", CurrentVersion: "1.0.0", LatestVersion: "2.0.0\nCANARY"}})
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	notify(context.Background(), "1.0.0", &output, path, NewClient(), now)
	if output.Len() != 0 {
		t.Fatal("unsafe cache emitted text")
	}
}
