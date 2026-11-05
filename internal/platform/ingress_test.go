package platform

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestProxyBindingEnrollmentAndDenials(t *testing.T) {
	valid := []string{"10.42.0.8:8201", "[2001:db8::8]:8202", "0.0.0.0:9000"}
	got, err := parseProxyBindings(valid, 8200)
	if err != nil || len(got) != 3 {
		t.Fatal(got, err)
	}
	for _, invalid := range [][]string{
		{"8201"}, {":8201"}, {"proxy.internal:8201"}, {"10.42.0.8:0"}, {"10.42.0.8:65536"},
		{"10.42.0.8:08201"}, {"10.42.0.8:+8201"}, {"[fe80::1%eth0]:8201"}, {"[::ffff:10.42.0.8]:8201"},
		{"224.0.0.1:8201"}, {"[2001:0db8::8]:8201"}, {"127.0.0.1:8200"}, {"0.0.0.0:8200"},
		{"10.42.0.8:8201", "10.42.0.8:8201"}, {"10.42.0.8:8201", "0.0.0.0:8201"},
		{"[::]:8201", "[2001:db8::8]:8201"},
	} {
		if _, err := parseProxyBindings(invalid, 8200); err == nil {
			t.Fatalf("accepted %v", invalid)
		}
	}
	for _, action := range []string{"upgrade", "recover", "rollback", "status"} {
		_, err := Execute(context.Background(), action, Options{Directory: filepath.Join(t.TempDir(), "absent"), ProxyBindings: valid}, io.Discard)
		if err == nil || !strings.Contains(err.Error(), "only for install or adopt") {
			t.Fatal(action, err)
		}
	}
}

func TestInstanceVersionAndPortDrift(t *testing.T) {
	legacy := `{"schemaVersion":"vaultix.instance-operation.v1","id":"instance-proof","project":"vaultix-proof","siteUrl":"https://vaultix.example","port":8200,"daemon":"test"}`
	var instance Instance
	if err := decode([]byte(legacy), &instance); err != nil {
		t.Fatal(err)
	}
	if err := instance.validate(); err != nil {
		t.Fatal(err)
	}
	ports := func(raw string) map[string][]struct{ HostIp, HostPort string } {
		var result map[string][]struct{ HostIp, HostPort string }
		if err := json.Unmarshal([]byte(raw), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	old := ports(`{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8200"}]}`)
	both := ports(`{"8080/tcp":[{"HostIp":"10.42.0.8","HostPort":"8201"},{"HostIp":"127.0.0.1","HostPort":"8200"}],"8081/tcp":null}`)
	if !instance.matchesPorts(old) || instance.matchesPorts(both) {
		t.Fatal("legacy ingress changed")
	}
	instance.ProxyBindings = []ProxyBinding{{HostIP: "10.42.0.8", Port: 8201}}
	if instance.validate() == nil {
		t.Fatal("extended v1 record accepted")
	}
	instance.SchemaVersion = InstanceSchema
	if err := instance.validate(); err != nil {
		t.Fatal(err)
	}
	if !instance.matchesPorts(both) || instance.matchesPorts(old) {
		t.Fatal("missing enrolled port accepted")
	}
	for _, raw := range []string{
		`{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8200"},{"HostIp":"0.0.0.0","HostPort":"8201"}]}`,
		`{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8200"},{"HostIp":"10.42.0.8","HostPort":"8202"}]}`,
		`{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8200"},{"HostIp":"10.42.0.8","HostPort":"8201"}],"9090/tcp":[{"HostIp":"0.0.0.0","HostPort":"9090"}]}`,
		`{"8080/tcp":[{"HostIp":"127.0.0.1","HostPort":"8200"},{"HostIp":"10.42.0.8","HostPort":"8201"},{"HostIp":"10.42.0.8","HostPort":"8201"}]}`,
	} {
		if instance.matchesPorts(ports(raw)) {
			t.Fatalf("accepted drift %s", raw)
		}
	}
}

func TestIngressPersistsAcrossDriverRestartAndCandidateSelection(t *testing.T) {
	root := privateTemp(t)
	i := Instance{SchemaVersion: InstanceSchema, ID: "instance-proof", Project: "vaultix-proof", SiteURL: "https://vaultix.example", Port: 8200, Daemon: "test", ProxyBindings: []ProxyBinding{{HostIP: "10.42.0.8", Port: 8201}}}
	if err := initialize(root, i, "", false); err != nil {
		t.Fatal(err)
	}
	raw, err := privateRead(configPath(root, "instance.json"), 65536)
	if err != nil {
		t.Fatal(err)
	}
	var restored Instance
	if err = decode(raw, &restored); err != nil || !reflect.DeepEqual(i, restored) {
		t.Fatal("lost enrolled listeners", err)
	}
	before, err := configuration(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, digest := range []string{strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("a", 64)} {
		d := Docker{root: root, instance: restored}
		path, err := d.selection("sha256:" + digest)
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var selected struct {
			Services map[string]struct {
				Ports []struct {
					HostIP    string `json:"host_ip"`
					Target    int
					Published string
					Protocol  string
				}
			}
		}
		if err = json.Unmarshal(data, &selected); err != nil {
			t.Fatal(err)
		}
		p := selected.Services["backend"].Ports
		if len(p) != 1 || p[0].HostIP != "10.42.0.8" || p[0].Target != 8080 || p[0].Published != "8201" || p[0].Protocol != "tcp" {
			t.Fatal("lost proxy listener on replacement", p)
		}
	}
	after, _ := configuration(root)
	if before != after {
		t.Fatal("selection mutated saved configuration")
	}
	i.ProxyBindings[0].Port = 8202
	changed, _ := json.Marshal(i)
	if err = os.WriteFile(configPath(root, "instance.json"), changed, 0600); err != nil {
		t.Fatal(err)
	}
	after, _ = configuration(root)
	if before == after {
		t.Fatal("binding drift not bound to saved operation")
	}
}
