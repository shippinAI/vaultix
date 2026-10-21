package deploy

import (
	"os"
	"regexp"
	"strings"

	"shippin.cloud/vaultix/panel/internal/license"
)

const (
	SKUSelf   = "self"
	SKUHosted = "hosted"
	HubHost   = "vaultix.shippin.cloud"
)

var labelRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,30}[a-z0-9]$|^[a-z]$`)

// Info is this running instance: who operates it, where it answers.
type Info struct {
	SKU        string `json:"sku"`
	Label      string `json:"label,omitempty"`
	PublicHost string `json:"publicHost"`
	Hub        bool   `json:"hub"`
	Owner      string `json:"owner"`
	Host       string `json:"host"`
	Product    string `json:"product"`
	Stamp      string `json:"stamp"`
}

func ValidLabel(label string) bool {
	return labelRe.MatchString(label)
}

func Load() Info {
	sku := strings.ToLower(strings.TrimSpace(os.Getenv("VAULTIX_SKU")))
	if sku != SKUHosted {
		sku = SKUSelf
	}
	label := strings.ToLower(strings.TrimSpace(os.Getenv("VAULTIX_LABEL")))
	pub := strings.TrimSpace(os.Getenv("VAULTIX_PUBLIC_HOST"))
	hub := false
	switch sku {
	case SKUHosted:
		if label == "" || label == "hub" {
			hub = true
			if pub == "" {
				pub = HubHost
			}
			label = ""
		} else if pub == "" {
			pub = label + "." + HubHost
		}
	default:
		if pub == "" {
			pub = "127.0.0.1:8201"
		}
	}
	return Info{
		SKU: sku, Label: label, PublicHost: pub, Hub: hub,
		Owner: license.Owner, Host: license.Host,
		Product: license.Product, Stamp: license.Stamp,
	}
}
