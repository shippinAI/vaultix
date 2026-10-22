package web

import "embed"

// Files is the Vaultix configure viewport. It renders A2UI from the
// instance; it is not leftover product chrome.
//
//go:embed index.html app.js manager.html welcome.html brand.css wordmark.svg favicon.svg mark.svg og.svg
var Files embed.FS
