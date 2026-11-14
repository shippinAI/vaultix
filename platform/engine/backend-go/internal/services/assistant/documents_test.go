package assistant

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vaultix-cloud/api/internal/services/assistant/spec"
)

type fixtureCase struct {
	Name        string          `json:"name"`
	Valid       bool            `json:"valid"`
	SchemaValid *bool           `json:"schemaValid"`
	Document    json.RawMessage `json:"document"`
}

func loadFixtures(t *testing.T, name string) []fixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("spec", "testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []fixtureCase `json:"cases"`
	}
	if err = json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Cases
}

// The same fixtures are checked against the JSON Schemas by scripts/test-ai-contracts.mjs, so a
// document Go accepts is one the schema (and therefore the UI) accepts, and the reverse.
func TestDocuments_FixturesAgreeWithTheSchemas(t *testing.T) {
	run := func(file string, decodeSchema func([]byte) error, decodeServer func([]byte) error) {
		for _, c := range loadFixtures(t, file) {
			schemaValid := c.Valid
			if c.SchemaValid != nil {
				schemaValid = *c.SchemaValid
			}
			if err := decodeSchema(c.Document); (err == nil) != schemaValid {
				t.Errorf("%s / %s: schema rules valid=%v, want %v (%v)", file, c.Name, err == nil, schemaValid, err)
			}
			if err := decodeServer(c.Document); (err == nil) != c.Valid {
				t.Errorf("%s / %s: server rules valid=%v, want %v (%v)", file, c.Name, err == nil, c.Valid, err)
			}
		}
	}
	run("connections.json",
		func(raw []byte) error {
			c, err := spec.DecodeConnection(raw)
			if err != nil {
				return err
			}
			return spec.ValidateConnection(c)
		},
		func(raw []byte) error {
			c, err := spec.DecodeConnection(raw)
			if err != nil {
				return err
			}
			return CheckConnection(c)
		})
	run("personas.json",
		func(raw []byte) error {
			p, err := spec.DecodePersona(raw)
			if err != nil {
				return err
			}
			return spec.ValidatePersona(p)
		},
		func(raw []byte) error {
			p, err := spec.DecodePersona(raw)
			if err != nil {
				return err
			}
			return CheckPersona(p)
		})
}

func TestDocuments_ErrorsNameTheField(t *testing.T) {
	c, _ := spec.DecodeConnection([]byte(`{"schemaVersion":"vaultix.ai-connection.v1","name":"B","kind":"bedrock","models":{"standard":"m"}}`))
	err := CheckConnection(c)
	errs, ok := err.(spec.Errors)
	if !ok || len(errs) != 1 || errs[0].Path != "region" || errs[0].Message == "" {
		t.Fatalf("errors = %#v", err)
	}
}
