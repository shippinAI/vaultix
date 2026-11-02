package main

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestDownloadCommandIntake(t *testing.T) {
	for _, args := range [][]string{nil, {"--version", "1.0.0"}, {"--unknown"}, {"--version", "1.0.0", "--directory", "x", "--trust", "x", "unexpected"}} {
		var out, progress bytes.Buffer
		if downloadRelease(context.Background(), args, &out, &progress) == nil || out.Len() != 0 || progress.Len() != 0 {
			t.Fatal("invalid download invocation accepted")
		}
	}
	var out, progress bytes.Buffer
	if err := downloadRelease(context.Background(), []string{"--help"}, &out, &progress); err != nil || !strings.Contains(out.String(), "--trust") || progress.Len() != 0 {
		t.Fatal("download help missing")
	}
	if !strings.Contains(usageText(), "update download") {
		t.Fatal("download command is not discoverable")
	}
}
