package config

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// IdentityTokenPolicy is immutable after startup. Its zero value is invalid;
// authentication must never silently substitute a lifetime for missing config.
type IdentityTokenPolicy struct {
	maxAge         time.Duration
	legacyDeadline time.Time
}

func (p IdentityTokenPolicy) MaxAge() time.Duration     { return p.maxAge }
func (p IdentityTokenPolicy) LegacyDeadline() time.Time { return p.legacyDeadline }
func (p IdentityTokenPolicy) Valid() bool {
	return p.maxAge >= time.Second
}

// Match the issuer's ms grammar, including unitless milliseconds and fractional
// single units. Compound Go durations would describe a different configuration.
var identityDurationPattern = regexp.MustCompile(`(?i)^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$`)
var identityDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$`)

func ParseIdentityTokenPolicy(maxAge, enforcedAt string) (IdentityTokenPolicy, error) {
	maxAge = strings.TrimSpace(maxAge)
	if maxAge == "" {
		maxAge = "90d"
	}
	parts := identityDurationPattern.FindStringSubmatch(maxAge)
	if len(maxAge) > 100 || parts == nil {
		return IdentityTokenPolicy{}, fmt.Errorf("MAX_MACHINE_IDENTITY_TOKEN_AGE must be a positive single-unit duration, such as 90d")
	}
	n, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return IdentityTokenPolicy{}, fmt.Errorf("MAX_MACHINE_IDENTITY_TOKEN_AGE exceeds supported precision")
	}
	multiplier := float64(1)
	switch strings.ToLower(parts[2]) {
	case "years", "year", "yrs", "yr", "y":
		multiplier = 365.25 * 24 * 60 * 60 * 1000
	case "weeks", "week", "w":
		multiplier = 7 * 24 * 60 * 60 * 1000
	case "days", "day", "d":
		multiplier = 24 * 60 * 60 * 1000
	case "hours", "hour", "hrs", "hr", "h":
		multiplier = 60 * 60 * 1000
	case "minutes", "minute", "mins", "min", "m":
		multiplier = 60 * 1000
	case "seconds", "second", "secs", "sec", "s":
		multiplier = 1000
	}
	seconds := math.Floor(n * multiplier / 1000)
	if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 1 || seconds > float64(math.MaxInt64/int64(time.Second)) {
		return IdentityTokenPolicy{}, fmt.Errorf("MAX_MACHINE_IDENTITY_TOKEN_AGE must resolve to 1 through 9223372036 whole seconds")
	}
	enforcedAt = strings.TrimSpace(enforcedAt)
	if enforcedAt == "" {
		enforcedAt = "2026-05-04T00:00:00.000Z"
	}
	anchor, err := parseIdentityEnforcementDate(enforcedAt)
	if err != nil {
		return IdentityTokenPolicy{}, err
	}
	age := time.Duration(int64(seconds)) * time.Second
	return IdentityTokenPolicy{maxAge: age, legacyDeadline: anchor.Add(age)}, nil
}

func parseIdentityEnforcementDate(value string) (time.Time, error) {
	// The existing issuer normalizes its broader JavaScript Date inputs to an
	// explicit epoch. This also preserves expanded years without locale parsing.
	if raw, ok := strings.CutPrefix(value, "unix-ms:"); ok {
		milliseconds, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || milliseconds < -8640000000000000 || milliseconds > 8640000000000000 {
			return time.Time{}, fmt.Errorf("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT has an invalid millisecond epoch")
		}
		return time.UnixMilli(milliseconds).UTC(), nil
	}
	if !identityDatePattern.MatchString(value) {
		return time.Time{}, fmt.Errorf("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT must be an ISO date or timestamp with a timezone")
	}
	anchor, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		anchor, err = time.Parse(time.DateOnly, value)
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("LEGACY_IDENTITY_ACCESS_TOKEN_EXPIRATION_ENFORCED_AT must be an ISO date or timestamp with a timezone")
	}
	// JavaScript Date has millisecond precision. Preserve the issuer's boundary.
	return anchor.UTC().Truncate(time.Millisecond), nil
}
