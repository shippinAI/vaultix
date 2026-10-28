package tenantprefix

import "errors"

var errShortID = errors.New("tenant prefix: short id must be 1–8 lowercase letters or digits")
