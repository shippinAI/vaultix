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
	if CommandName("/usr/local/bin/infisical") != "infisical" {
		t.Fatal("infisical argv0")
	}
	if CommandName("vaultix.exe") != "vaultix" {
		t.Fatal("vaultix.exe")
	}
}
