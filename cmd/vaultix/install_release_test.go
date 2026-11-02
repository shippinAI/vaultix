package main

import (
	"bytes"
	"context"
	"testing"
)

func TestInstallReleaseArguments(t *testing.T) {
	for _, args := range [][]string{{}, {"--directory", "x"}, {"--version", "1.2.3"}, {"--directory", "x", "--version", "1.2.3", "--bundle", "y"}, {"--directory", "x", "--bundle", "y", "extra"}, {"--unknown"}} {
		var out bytes.Buffer
		if err := installRelease(context.Background(), args, &out, &out); err == nil || out.Len() != 0 {
			t.Fatal(args, "invalid args accepted")
		}
	}
	var out bytes.Buffer
	if err := installRelease(context.Background(), []string{"--help"}, &out, &out); err != nil || !bytes.Contains(out.Bytes(), []byte("vaultix update install")) {
		t.Fatal(err)
	}
}
func TestInstallationStatusArguments(t *testing.T) {
	for _, args := range [][]string{{}, {"--directory", "x", "extra"}, {"--unknown"}} {
		var out bytes.Buffer
		if err := installationStatus(args, &out); err == nil || out.Len() != 0 {
			t.Fatal(args)
		}
	}
}
