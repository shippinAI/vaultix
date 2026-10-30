package cli

import "testing"

func TestChooseLogin(t *testing.T) {
	mode, err := chooseLogin(false, false, false, true)
	if err != nil || mode != modeSSO {
		t.Fatalf("terminal: %v %v", mode, err)
	}
	mode, err = chooseLogin(false, false, false, false)
	if err != nil || mode != modeToken {
		t.Fatalf("pipe: %v %v", mode, err)
	}
	mode, err = chooseLogin(true, false, false, true)
	if err != nil || mode != modeUniversal {
		t.Fatalf("universal: %v %v", mode, err)
	}
	if _, err = chooseLogin(true, false, true, false); err == nil {
		t.Fatal("expected two flags to fail")
	}
}

func TestCommandName(t *testing.T) {
	for input, expected := range map[string]string{
		"/usr/local/bin/vaultixl":  "vaultixl",
		`C:\tools\vaultixl.exe`:    "vaultixl",
		"VAULTIXL.EXE":             "vaultixl",
		"vaultix.exe":              "vaultix",
		"/usr/local/bin/infisical": "vaultix",
	} {
		if got := CommandName(input); got != expected {
			t.Errorf("command name %q: got %q, want %q", input, got, expected)
		}
	}
}
