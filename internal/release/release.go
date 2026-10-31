package release

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const LatestURL = "https://api.github.com/repos/shippinAI/vaultix/releases/latest"
const ReleasesURL = "https://github.com/shippinAI/vaultix/releases"

var pattern = regexp.MustCompile(`^[vV]?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$`)
var numeric = regexp.MustCompile(`^[0-9]+$`)

type Version struct {
	core []string
	pre  []string
}

func Parse(s string) (Version, bool) {
	if len(s) > 128 {
		return Version{}, false
	}
	m := pattern.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return Version{}, false
	}
	v := Version{core: m[1:4]}
	for _, part := range v.core {
		n, err := strconv.ParseUint(part, 10, 64)
		if err != nil || n > 9007199254740991 {
			return Version{}, false
		}
	}
	if m[4] != "" {
		v.pre = strings.Split(m[4], ".")
		for _, p := range v.pre {
			if numeric.MatchString(p) && len(p) > 1 && p[0] == '0' {
				return Version{}, false
			}
		}
	}
	return v, true
}

func numberCompare(a, b string) int {
	if len(a) < len(b) {
		return -1
	}
	if len(a) > len(b) {
		return 1
	}
	return strings.Compare(a, b)
}

func Compare(a, b Version) int {
	for i := 0; i < 3; i++ {
		if c := numberCompare(a.core[i], b.core[i]); c != 0 {
			return c
		}
	}
	if len(a.pre) == 0 && len(b.pre) == 0 {
		return 0
	}
	if len(a.pre) == 0 {
		return 1
	}
	if len(b.pre) == 0 {
		return -1
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		x, y := a.pre[i], b.pre[i]
		nx, ny := numeric.MatchString(x), numeric.MatchString(y)
		if nx && !ny {
			return -1
		}
		if !nx && ny {
			return 1
		}
		c := strings.Compare(x, y)
		if nx && ny {
			c = numberCompare(x, y)
		}
		if c != 0 {
			return c
		}
	}
	if len(a.pre) < len(b.pre) {
		return -1
	}
	if len(a.pre) > len(b.pre) {
		return 1
	}
	return 0
}

type Status struct {
	SchemaVersion  string `json:"schemaVersion"`
	State          string `json:"state"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion,omitempty"`
	ReleaseURL     string `json:"releaseUrl"`
	Channel        string `json:"channel"`
}

type Client struct{ HTTP *http.Client }

func NewClient() Client {
	return Client{HTTP: &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c Client) Check(ctx context.Context, current string) (Status, error) {
	status := Status{SchemaVersion: "vaultix.updates.v1", State: "development", CurrentVersion: current, ReleaseURL: ReleasesURL, Channel: "stable"}
	installed, valid := Parse(current)
	if !valid {
		return status, nil
	}
	status.State = "unavailable"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, LatestURL, nil)
	if err != nil {
		return status, errors.New("could not prepare update check")
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "vaultix-cli")
	response, err := c.HTTP.Do(req)
	if err != nil {
		return status, errors.New("could not check Vaultix releases; check your connection and try again")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		status.State = "unpublished"
		return status, nil
	}
	if response.StatusCode != http.StatusOK {
		return status, errors.New("Vaultix release service is unavailable; try again later")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(data) > 65536 {
		return status, errors.New("invalid Vaultix release response")
	}
	var published struct {
		Tag        string `json:"tag_name"`
		Draft      *bool  `json:"draft"`
		Prerelease *bool  `json:"prerelease"`
		Published  string `json:"published_at"`
	}
	if json.Unmarshal(data, &published) != nil || published.Draft == nil || *published.Draft || published.Prerelease == nil || *published.Prerelease {
		return status, errors.New("invalid Vaultix release response")
	}
	latest, valid := Parse(published.Tag)
	_, dateError := time.Parse(time.RFC3339, published.Published)
	if !valid || len(latest.pre) > 0 || dateError != nil || strings.TrimSpace(published.Tag) != published.Tag {
		return status, errors.New("invalid Vaultix stable release")
	}
	status.LatestVersion = strings.TrimPrefix(strings.TrimPrefix(published.Tag, "v"), "V")
	status.ReleaseURL = ReleasesURL + "/tag/" + published.Tag
	status.State = "current"
	if Compare(latest, installed) > 0 {
		status.State = "available"
	}
	return status, nil
}
