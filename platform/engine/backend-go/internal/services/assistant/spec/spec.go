// Package spec holds the v1 documents for AI connections and personas (docs/0126) and validates
// them by exactly the rules of the embedded JSON Schemas, which the UI also reads (served at
// GET /api/vx/v1/ai/schema). Lengths are counted in characters, as JSON Schema counts them. A shared
// fixture set (testdata) is checked against both these rules and the schemas.
package spec

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

const (
	ConnectionVersion = "vaultix.ai-connection.v1"
	PersonaVersion    = "vaultix.ai-persona.v1"
)

//go:embed schema/*.json
var Schemas embed.FS

var (
	Kinds    = []string{"anthropic", "openai", "bedrock", "vertex", "huggingface", "huggingface-endpoint", "custom"}
	Roles    = []string{"router", "specialist", "guard"}
	Tiers    = []string{"fast", "standard", "deep"}
	Domains  = []string{"public", "auth", "workspace", "secrets", "access", "automation", "connect", "pki", "kms", "pam", "detect", "ai", "governance", "operate", "experience"}
	APIStyle = []string{"openai-chat", "anthropic-messages"}
	Auths    = []string{"bearer", "header", "none"}

	modelPattern      = regexp.MustCompile(`^[A-Za-z0-9._:/@-]+$`)
	endpointPattern   = regexp.MustCompile(`^https?://[A-Za-z0-9.\-\[\]:]+(/[A-Za-z0-9._~!$&'()*+,;=:@%/\-]*)?$`)
	loopbackHTTP      = regexp.MustCompile(`^http://(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?(/|$)`)
	headerNamePattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
	awsRegion         = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	gcpRegion         = regexp.MustCompile(`^(global|[a-z]+-[a-z]+[0-9])$`)
	gcpProject        = regexp.MustCompile(`^[a-z][a-z0-9-]{4,28}[a-z0-9]$`)
	billToPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`)
	accessKeyID       = regexp.MustCompile(`^[A-Z0-9]{16,128}$`)
	slugPattern       = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
	uuidPattern       = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	toolPattern       = regexp.MustCompile(`^vaultix(\.[a-z][a-z0-9-]*)+$`)

	reservedAuthHeaders = []string{"authorization", "cookie", "proxy-authorization", "host", "content-length", "content-type"}
	reservedHeaders     = []string{"authorization", "cookie", "proxy-authorization", "x-api-key", "api-key", "host", "content-length", "content-type", "x-hf-bill-to"}
)

type Connection struct {
	SchemaVersion  string      `json:"schemaVersion"`
	Name           string      `json:"name"`
	Kind           string      `json:"kind"`
	Endpoint       *string     `json:"endpoint,omitempty"`
	APIStyle       *string     `json:"apiStyle,omitempty"`
	Auth           *Auth       `json:"auth,omitempty"`
	Headers        []Header    `json:"headers,omitempty"`
	Region         *string     `json:"region,omitempty"`
	CloudProject   *string     `json:"cloudProject,omitempty"`
	BillTo         *string     `json:"billTo,omitempty"`
	Models         Models      `json:"models"`
	TimeoutSeconds *int        `json:"timeoutSeconds,omitempty"`
	Active         *bool       `json:"active,omitempty"`
	Credential     *Credential `json:"credential,omitempty"`
}

type Auth struct {
	Type       string  `json:"type"`
	HeaderName *string `json:"headerName,omitempty"`
}

type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Models struct {
	Standard string  `json:"standard"`
	Fast     *string `json:"fast,omitempty"`
	Deep     *string `json:"deep,omitempty"`
}

type Credential struct {
	APIKey             *string `json:"apiKey,omitempty"`
	AccessKeyID        *string `json:"accessKeyId,omitempty"`
	SecretAccessKey    *string `json:"secretAccessKey,omitempty"`
	SessionToken       *string `json:"sessionToken,omitempty"`
	ServiceAccountJSON *string `json:"serviceAccountJson,omitempty"`
}

type Persona struct {
	SchemaVersion string         `json:"schemaVersion" yaml:"schemaVersion"`
	Slug          string         `json:"slug" yaml:"slug"`
	Name          string         `json:"name" yaml:"name"`
	Description   string         `json:"description" yaml:"description"`
	Role          string         `json:"role" yaml:"role"`
	Domains       []string       `json:"domains" yaml:"domains"`
	Instructions  string         `json:"instructions" yaml:"-"`
	Model         PersonaModel   `json:"model" yaml:"model"`
	ModelSettings *ModelSettings `json:"modelSettings,omitempty" yaml:"modelSettings,omitempty"`
	Tools         []string       `json:"tools" yaml:"tools"`
	Handoffs      []string       `json:"handoffs,omitempty" yaml:"handoffs,omitempty"`
	Memory        *MemoryUse     `json:"memory,omitempty" yaml:"memory,omitempty"`
	Enabled       *bool          `json:"enabled,omitempty" yaml:"enabled,omitempty"`
}

type PersonaModel struct {
	ConnectionID *string `json:"connectionId,omitempty" yaml:"connectionId,omitempty"`
	Tier         string  `json:"tier" yaml:"tier"`
	ID           *string `json:"id,omitempty" yaml:"id,omitempty"`
}

type ModelSettings struct {
	Temperature     *float64 `json:"temperature,omitempty" yaml:"temperature,omitempty"`
	TopP            *float64 `json:"topP,omitempty" yaml:"topP,omitempty"`
	MaxOutputTokens *int     `json:"maxOutputTokens,omitempty" yaml:"maxOutputTokens,omitempty"`
	StopSequences   []string `json:"stopSequences,omitempty" yaml:"stopSequences,omitempty"`
	ToolChoice      *string  `json:"toolChoice,omitempty" yaml:"toolChoice,omitempty"`
}

type MemoryUse struct {
	Use string `json:"use" yaml:"use"`
}

// FieldError names the field by its JSON path, so the UI can show the message beside it.
type FieldError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type Errors []FieldError

func (e Errors) Error() string {
	parts := make([]string, len(e))
	for i, f := range e {
		parts[i] = f.Path + ": " + f.Message
	}
	return strings.Join(parts, "; ")
}

type checker struct{ errs Errors }

func (c *checker) fail(path, format string, args ...any) {
	c.errs = append(c.errs, FieldError{Path: path, Message: fmt.Sprintf(format, args...)})
}

func (c *checker) text(path, value string, minChars, maxChars int, label string) {
	n := utf8.RuneCountInString(value)
	switch {
	case n < minChars:
		c.fail(path, "%s is required.", label)
	case n > maxChars:
		c.fail(path, "%s must be at most %d characters.", label, maxChars)
	case minChars > 0 && strings.TrimSpace(value) == "":
		c.fail(path, "%s cannot be only spaces.", label)
	}
}

func (c *checker) model(path string, value *string, label string) {
	if value == nil {
		return
	}
	if n := utf8.RuneCountInString(*value); n == 0 || n > 128 || !modelPattern.MatchString(*value) {
		c.fail(path, "%s must be 1 to 128 letters, digits or . _ : / @ -.", label)
	}
}

func (c *checker) forbid(kind string, fields map[string]bool) {
	for name, present := range fields {
		if present {
			c.fail(name, "Not used by %s connections; leave it out.", kind)
		}
	}
}

func (c *checker) result() error {
	if len(c.errs) == 0 {
		return nil
	}
	slices.SortStableFunc(c.errs, func(a, b FieldError) int { return strings.Compare(a.Path, b.Path) })
	return c.errs
}

// DecodeConnection reads a document strictly: unknown fields and wrong types are refused, as the
// schema's additionalProperties:false and types refuse them.
func DecodeConnection(raw []byte) (*Connection, error) {
	var c Connection
	if err := strictDecode(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func DecodePersona(raw []byte) (*Persona, error) {
	var p Persona
	if err := strictDecode(raw, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func strictDecode(raw []byte, into any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(into); err != nil {
		return Errors{{Path: "", Message: "The document is not valid: " + err.Error()}}
	}
	if decoder.More() {
		return Errors{{Path: "", Message: "The document must be one JSON object."}}
	}
	return nil
}

func ValidateConnection(c *Connection) error {
	v := &checker{}
	if c.SchemaVersion != ConnectionVersion {
		v.fail("schemaVersion", "Must be %q.", ConnectionVersion)
	}
	v.text("name", c.Name, 1, 64, "Name")
	if !slices.Contains(Kinds, c.Kind) {
		v.fail("kind", "Choose one of %s.", strings.Join(Kinds, ", "))
	}
	if c.Models.Standard == "" {
		v.fail("models.standard", "The standard model is required.")
	} else {
		v.model("models.standard", &c.Models.Standard, "The standard model")
	}
	v.model("models.fast", c.Models.Fast, "The fast model")
	v.model("models.deep", c.Models.Deep, "The deep model")
	if c.TimeoutSeconds != nil && (*c.TimeoutSeconds < 5 || *c.TimeoutSeconds > 120) {
		v.fail("timeoutSeconds", "The timeout must be 5 to 120 seconds.")
	}
	if c.Endpoint != nil {
		e := *c.Endpoint
		if utf8.RuneCountInString(e) > 512 || !endpointPattern.MatchString(e) {
			v.fail("endpoint", "Use an http(s) address with no user name, password, query or fragment, at most 512 characters.")
		} else if u, err := url.Parse(e); err != nil || u.Host == "" {
			v.fail("endpoint", "The address has no host.")
		} else if strings.HasPrefix(e, "http://") && !loopbackHTTP.MatchString(e) && (c.Auth == nil || c.Auth.Type != "none") {
			v.fail("endpoint", "A key is only sent over https. Use https, or send no key.")
		}
	}
	if c.Auth != nil {
		if !slices.Contains(Auths, c.Auth.Type) {
			v.fail("auth.type", "Choose bearer, header or none.")
		}
		switch {
		case c.Auth.Type == "header" && c.Auth.HeaderName == nil:
			v.fail("auth.headerName", "Name the header that carries the key.")
		case c.Auth.Type != "header" && c.Auth.HeaderName != nil:
			v.fail("auth.headerName", "Only used when the key is sent in a named header.")
		case c.Auth.HeaderName != nil && (!headerNamePattern.MatchString(*c.Auth.HeaderName) || slices.Contains(reservedAuthHeaders, *c.Auth.HeaderName)):
			v.fail("auth.headerName", "Use a lowercase header name of letters, digits and dashes that HTTP does not reserve.")
		}
		if c.Auth.Type == "none" && c.Credential != nil {
			v.fail("credential", "No key is sent with this connection; leave the key out.")
		}
	}
	if len(c.Headers) > 8 {
		v.fail("headers", "At most 8 extra headers.")
	}
	for i, h := range c.Headers {
		path := fmt.Sprintf("headers[%d]", i)
		if !headerNamePattern.MatchString(h.Name) || slices.Contains(reservedHeaders, h.Name) {
			v.fail(path+".name", "Use a lowercase header name of letters, digits and dashes; keys and reserved headers cannot go here.")
		}
		v.text(path+".value", h.Value, 1, 256, "The header value")
	}
	if c.Region != nil {
		v.text("region", *c.Region, 1, 32, "Region")
	}
	if c.CloudProject != nil && !gcpProject.MatchString(*c.CloudProject) {
		v.fail("cloudProject", "Use the Google Cloud project ID (6 to 30 lowercase letters, digits or dashes).")
	}
	if c.BillTo != nil && !billToPattern.MatchString(*c.BillTo) {
		v.fail("billTo", "Use a Hugging Face account or organization name.")
	}
	cred := c.Credential
	if cred != nil {
		if cred.APIKey == nil && cred.AccessKeyID == nil && cred.SecretAccessKey == nil && cred.SessionToken == nil && cred.ServiceAccountJSON == nil {
			v.fail("credential", "Enter the key, or leave the key out to keep the stored one.")
		}
		for path, value := range map[string]*string{"credential.apiKey": cred.APIKey, "credential.secretAccessKey": cred.SecretAccessKey, "credential.sessionToken": cred.SessionToken} {
			if value != nil {
				v.text(path, *value, 1, 4096, "The key")
			}
		}
		if cred.ServiceAccountJSON != nil {
			v.text("credential.serviceAccountJson", *cred.ServiceAccountJSON, 1, 16384, "The service account key")
		}
		if cred.AccessKeyID != nil && !accessKeyID.MatchString(*cred.AccessKeyID) {
			v.fail("credential.accessKeyId", "Use the AWS access key ID (16 to 128 uppercase letters and digits).")
		}
	}
	has := func(p *string) bool { return p != nil }
	switch c.Kind {
	case "anthropic", "openai":
		v.forbid(c.Kind, map[string]bool{"endpoint": has(c.Endpoint), "apiStyle": has(c.APIStyle), "auth": c.Auth != nil, "headers": c.Headers != nil, "region": has(c.Region), "cloudProject": has(c.CloudProject), "billTo": has(c.BillTo)})
	case "bedrock":
		v.forbid(c.Kind, map[string]bool{"endpoint": has(c.Endpoint), "apiStyle": has(c.APIStyle), "auth": c.Auth != nil, "headers": c.Headers != nil, "cloudProject": has(c.CloudProject), "billTo": has(c.BillTo)})
		if c.Region == nil {
			v.fail("region", "Bedrock needs its AWS region.")
		} else if !awsRegion.MatchString(*c.Region) {
			v.fail("region", "Use an AWS region such as us-east-1.")
		}
	case "vertex":
		v.forbid(c.Kind, map[string]bool{"endpoint": has(c.Endpoint), "apiStyle": has(c.APIStyle), "auth": c.Auth != nil, "headers": c.Headers != nil, "billTo": has(c.BillTo)})
		if c.Region == nil {
			v.fail("region", "Vertex needs its Google Cloud region.")
		} else if !gcpRegion.MatchString(*c.Region) {
			v.fail("region", "Use a Google Cloud region such as us-east5, or global.")
		}
		if c.CloudProject == nil {
			v.fail("cloudProject", "Vertex needs the Google Cloud project ID.")
		}
	case "huggingface":
		v.forbid(c.Kind, map[string]bool{"endpoint": has(c.Endpoint), "apiStyle": has(c.APIStyle), "auth": c.Auth != nil, "headers": c.Headers != nil, "region": has(c.Region), "cloudProject": has(c.CloudProject)})
	case "huggingface-endpoint":
		v.forbid(c.Kind, map[string]bool{"apiStyle": has(c.APIStyle), "auth": c.Auth != nil, "headers": c.Headers != nil, "region": has(c.Region), "cloudProject": has(c.CloudProject), "billTo": has(c.BillTo)})
		if c.Endpoint == nil {
			v.fail("endpoint", "Paste the endpoint's URL from Hugging Face.")
		} else if !strings.HasPrefix(*c.Endpoint, "https://") {
			v.fail("endpoint", "Hugging Face endpoints use https.")
		}
	case "custom":
		v.forbid(c.Kind, map[string]bool{"region": has(c.Region), "cloudProject": has(c.CloudProject), "billTo": has(c.BillTo)})
		if c.Endpoint == nil {
			v.fail("endpoint", "Enter the endpoint URL.")
		}
		if c.APIStyle == nil {
			v.fail("apiStyle", "Choose the API style the endpoint speaks.")
		} else if !slices.Contains(APIStyle, *c.APIStyle) {
			v.fail("apiStyle", "Choose openai-chat or anthropic-messages.")
		}
		if c.Auth == nil {
			v.fail("auth", "Say how the key is sent: bearer, a named header, or none.")
		}
	}
	if cred != nil {
		allowed := map[string][]string{
			"bedrock": {"accessKeyId", "secretAccessKey", "sessionToken"},
			"vertex":  {"serviceAccountJson"},
		}[c.Kind]
		if allowed == nil {
			allowed = []string{"apiKey"}
		}
		for name, present := range map[string]bool{"apiKey": has(cred.APIKey), "accessKeyId": has(cred.AccessKeyID), "secretAccessKey": has(cred.SecretAccessKey), "sessionToken": has(cred.SessionToken), "serviceAccountJson": has(cred.ServiceAccountJSON)} {
			if present && !slices.Contains(allowed, name) {
				v.fail("credential."+name, "Not used by %s connections.", c.Kind)
			}
		}
		if c.Kind == "bedrock" && has(cred.AccessKeyID) != has(cred.SecretAccessKey) {
			v.fail("credential", "Bedrock needs the access key ID and secret access key together.")
		}
	}
	return v.result()
}

func ValidatePersona(p *Persona) error {
	v := &checker{}
	if p.SchemaVersion != PersonaVersion {
		v.fail("schemaVersion", "Must be %q.", PersonaVersion)
	}
	if !slugPattern.MatchString(p.Slug) {
		v.fail("slug", "Use 2 to 32 lowercase letters, digits or dashes, starting with a letter.")
	}
	v.text("name", p.Name, 1, 64, "Name")
	v.text("description", p.Description, 1, 300, "When to use it")
	v.text("instructions", p.Instructions, 1, 16384, "Instructions")
	if !slices.Contains(Roles, p.Role) {
		v.fail("role", "Choose router, specialist or guard.")
	}
	switch {
	case len(p.Domains) == 0:
		v.fail("domains", "Choose at least one area.")
	case len(p.Domains) > 8:
		v.fail("domains", "Choose at most 8 areas.")
	}
	for i, d := range p.Domains {
		if !slices.Contains(Domains, d) {
			v.fail(fmt.Sprintf("domains[%d]", i), "%q is not an area.", d)
		} else if slices.Index(p.Domains, d) != i {
			v.fail(fmt.Sprintf("domains[%d]", i), "%q is listed twice.", d)
		}
	}
	if !slices.Contains(Tiers, p.Model.Tier) {
		v.fail("model.tier", "Choose fast, standard or deep.")
	}
	if p.Model.ConnectionID != nil && !uuidPattern.MatchString(*p.Model.ConnectionID) {
		v.fail("model.connectionId", "Choose a connection.")
	}
	v.model("model.id", p.Model.ID, "The model ID")
	if s := p.ModelSettings; s != nil {
		if s.Temperature != nil && (*s.Temperature < 0 || *s.Temperature > 2) {
			v.fail("modelSettings.temperature", "Temperature must be 0 to 2.")
		}
		if s.TopP != nil && (*s.TopP <= 0 || *s.TopP > 1) {
			v.fail("modelSettings.topP", "Top-p must be above 0 and at most 1.")
		}
		if s.MaxOutputTokens != nil && (*s.MaxOutputTokens < 1 || *s.MaxOutputTokens > 32000) {
			v.fail("modelSettings.maxOutputTokens", "The longest answer must be 1 to 32,000 tokens.")
		}
		if len(s.StopSequences) > 4 {
			v.fail("modelSettings.stopSequences", "At most 4 stop sequences.")
		}
		for i, stop := range s.StopSequences {
			v.text(fmt.Sprintf("modelSettings.stopSequences[%d]", i), stop, 1, 64, "A stop sequence")
		}
		if s.ToolChoice != nil && *s.ToolChoice != "auto" && *s.ToolChoice != "none" {
			v.fail("modelSettings.toolChoice", "Choose auto or none.")
		}
	}
	if len(p.Tools) > 64 {
		v.fail("tools", "At most 64 tools.")
	}
	for i, tool := range p.Tools {
		if utf8.RuneCountInString(tool) > 128 || !toolPattern.MatchString(tool) {
			v.fail(fmt.Sprintf("tools[%d]", i), "%q is not a Vaultix tool name.", tool)
		} else if slices.Index(p.Tools, tool) != i {
			v.fail(fmt.Sprintf("tools[%d]", i), "%q is listed twice.", tool)
		}
	}
	if p.Handoffs != nil && p.Role != "router" {
		v.fail("handoffs", "Only the router hands off.")
	}
	if len(p.Handoffs) > 16 {
		v.fail("handoffs", "At most 16 handoffs.")
	}
	for i, h := range p.Handoffs {
		if !slugPattern.MatchString(h) {
			v.fail(fmt.Sprintf("handoffs[%d]", i), "%q is not a persona short name.", h)
		} else if slices.Index(p.Handoffs, h) != i {
			v.fail(fmt.Sprintf("handoffs[%d]", i), "%q is listed twice.", h)
		}
	}
	if p.Memory != nil && !slices.Contains([]string{"all", "instance", "none"}, p.Memory.Use) {
		v.fail("memory.use", "Choose all, instance or none.")
	}
	if p.Role == "router" && p.Enabled != nil && !*p.Enabled {
		v.fail("enabled", "The router answers when no one else does; it cannot be turned off.")
	}
	return v.result()
}
