package platform

import (
	"errors"
	"net"
	"net/netip"
	"slices"
	"strconv"
)

// Proxy bindings are explicit host listeners for the existing HTTP service.
// They are configuration, never inferred authority from a running container.
const InstanceSchema = "vaultix.instance.v2"

type ProxyBinding struct {
	HostIP string `json:"hostIp"`
	Port   int    `json:"port"`
}

func parseProxyBindings(values []string, loopbackPort int) ([]ProxyBinding, error) {
	var bindings []ProxyBinding
	for _, value := range values {
		host, port, err := net.SplitHostPort(value)
		if err != nil {
			return nil, errors.New("--proxy-bind requires an explicit IP:PORT (IPv6: [IP]:PORT)")
		}
		number, err := strconv.Atoi(port)
		if err != nil || strconv.Itoa(number) != port {
			return nil, errors.New("invalid proxy port")
		}
		bindings = append(bindings, ProxyBinding{HostIP: host, Port: number})
	}
	slices.SortFunc(bindings, func(a, b ProxyBinding) int {
		if a.HostIP < b.HostIP {
			return -1
		}
		if a.HostIP > b.HostIP {
			return 1
		}
		return a.Port - b.Port
	})
	return bindings, validateProxyBindings(bindings, loopbackPort)
}

func validateProxyBindings(bindings []ProxyBinding, loopbackPort int) error {
	if len(bindings) > 8 {
		return errors.New("at most eight additional proxy bindings are supported")
	}
	seen := []ProxyBinding{{HostIP: "127.0.0.1", Port: loopbackPort}}
	for _, binding := range bindings {
		ip, err := netip.ParseAddr(binding.HostIP)
		if err != nil || ip.Zone() != "" || ip.Is4In6() || ip.IsMulticast() || ip.String() != binding.HostIP || binding.Port < 1 || binding.Port > 65535 {
			return errors.New("proxy bindings require canonical IP literals and ports from 1 to 65535")
		}
		for _, prior := range seen {
			other := netip.MustParseAddr(prior.HostIP)
			if prior.Port == binding.Port && (other == ip || other.Is4() == ip.Is4() && (other.IsUnspecified() || ip.IsUnspecified())) {
				return errors.New("duplicate or overlapping application port bindings")
			}
		}
		seen = append(seen, binding)
	}
	return nil
}

func (i Instance) matchesPorts(ports map[string][]struct{ HostIp, HostPort string }) bool {
	expected := map[ProxyBinding]bool{{HostIP: "127.0.0.1", Port: i.Port}: true}
	for _, binding := range i.ProxyBindings {
		expected[binding] = true
	}
	for target, bindings := range ports {
		if target != "8080/tcp" && len(bindings) != 0 {
			return false
		}
		for _, binding := range bindings {
			port, err := strconv.Atoi(binding.HostPort)
			key := ProxyBinding{HostIP: binding.HostIp, Port: port}
			if err != nil || strconv.Itoa(port) != binding.HostPort || !expected[key] {
				return false
			}
			delete(expected, key)
		}
	}
	return len(expected) == 0
}
