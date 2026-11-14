package platform

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestOwnerResetLinkArgumentsAreRefusedBeforeDocker(t *testing.T) {
	dir := privateTemp(t)
	for _, c := range []struct {
		action string
		o      Options
	}{
		{"status", Options{Email: "owner@vaultix.invalid"}},
		{"upgrade", Options{Email: "owner@vaultix.invalid"}},
		{"owner-reset-link", Options{BuildReceipt: "receipt.json"}},
		{"owner-reset-link", Options{Plan: true}},
	} {
		c.o.Directory = dir
		_, err := Execute(context.Background(), c.action, c.o, io.Discard)
		if err == nil || !strings.Contains(err.Error(), "do not belong") {
			t.Fatalf("%s %+v: got %v", c.action, c.o, err)
		}
	}
}

func TestOwnerRecoveryScriptKeepsValuesOutOfArguments(t *testing.T) {
	if strings.Count(ownerRecoveryScript, "%s") != 1 || !strings.Contains(ownerRecoveryScript, `flag: "wx"`) || !strings.Contains(ownerRecoveryScript, "127.0.0.1:8080") {
		t.Fatal("the recovery script must take its values only from one embedded JSON literal and write the code once over loopback")
	}
}
