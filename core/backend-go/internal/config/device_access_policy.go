package config

import (
	"fmt"
	"strconv"
	"time"
)

type DeviceAccessPolicy struct {
	Enabled  bool
	Lifetime time.Duration
}

func ParseDeviceAuthorizationEnabled(value string, access DeviceAccessPolicy) (bool, error) {
	if value == "" {
		return false, nil
	}
	enabled, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("VAULTIX_DEVICE_AUTHORIZATION_ENABLED must be a boolean")
	}
	if enabled && !access.Enabled {
		return false, fmt.Errorf("VAULTIX_DEVICE_AUTHORIZATION_ENABLED requires VAULTIX_DEVICE_ACCESS_ENABLED")
	}
	return enabled, nil
}

func ParseDeviceAccessPolicy(enabled, seconds string) (DeviceAccessPolicy, error) {
	policy := DeviceAccessPolicy{Lifetime: 15 * time.Minute}
	if enabled != "" {
		value, err := strconv.ParseBool(enabled)
		if err != nil {
			return DeviceAccessPolicy{}, fmt.Errorf("VAULTIX_DEVICE_ACCESS_ENABLED must be a boolean")
		}
		policy.Enabled = value
	}
	if seconds != "" {
		for _, digit := range seconds {
			if digit < '0' || digit > '9' {
				return DeviceAccessPolicy{}, fmt.Errorf("VAULTIX_DEVICE_ACCESS_TTL_SECONDS must be an integer from 1 to 86400")
			}
		}
		value, err := strconv.ParseUint(seconds, 10, 32)
		if err != nil || value < 1 || value > 86400 {
			return DeviceAccessPolicy{}, fmt.Errorf("VAULTIX_DEVICE_ACCESS_TTL_SECONDS must be an integer from 1 to 86400")
		}
		policy.Lifetime = time.Duration(value) * time.Second
	}
	return policy, nil
}
