package assistant

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListModels_AnthropicPagesWithTheKey(t *testing.T) {
	pages := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/models" || r.Header.Get("x-api-key") != canaryKey || r.Header.Get("anthropic-version") == "" {
			http.Error(w, `{"error":{"message":"bad request"}}`, http.StatusBadRequest)
			return
		}
		pages++
		if r.URL.Query().Get("after_id") == "" {
			_, _ = w.Write([]byte(`{"data":[{"id":"claude-opus-5-5","display_name":"Claude Opus 5.5"}],"has_more":true,"last_id":"claude-opus-5-5"}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5"}],"has_more":false}`))
	}))
	defer server.Close()
	models, err := ListModels(context.Background(), &Provider{Kind: KindAnthropic, BaseURL: server.URL}, &Credential{APIKey: canaryKey}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 || len(models) != 2 || models[1].ID != "claude-haiku-5-5" || models[0].Name != "Claude Opus 5.5" {
		t.Fatalf("pages %d models %+v", pages, models)
	}
}

func TestListModels_OpenAIDropsModelsThatCannotChat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer "+canaryKey {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"data":[{"id":"text-embedding-3-small"},{"id":"gpt-z"},{"id":"gpt-a"},{"id":"whisper-1"}]}`))
	}))
	defer server.Close()
	models, err := ListModels(context.Background(), &Provider{Kind: KindOpenAI, BaseURL: server.URL + "/v1"}, &Credential{APIKey: canaryKey}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].ID != "gpt-a" || models[1].ID != "gpt-z" {
		t.Fatalf("models %+v", models)
	}
	compatible, err := ListModels(context.Background(), &Provider{Kind: KindOpenAICompatible, BaseURL: server.URL + "/v1"}, &Credential{APIKey: canaryKey}, nil)
	if err != nil || len(compatible) != 4 {
		t.Fatalf("a compatible server's list is kept whole: %+v %v", compatible, err)
	}
	_, err = ListModels(context.Background(), &Provider{Kind: KindOpenAI, BaseURL: server.URL + "/v1"}, &Credential{APIKey: "wrong"}, nil)
	if err == nil || !strings.Contains(err.Error(), "refused the credential") {
		t.Fatalf("refusal: %v", err)
	}
}

func TestListModels_BedrockSignsAndKeepsAnthropic(t *testing.T) {
	seen := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY0001/") || !strings.Contains(r.Header.Get("Authorization"), "/bedrock/aws4_request") {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		seen = append(seen, r.URL.Path)
		switch r.URL.Path {
		case "/inference-profiles":
			_, _ = w.Write([]byte(`{"inferenceProfileSummaries":[{"inferenceProfileId":"us.anthropic.claude-sonnet-5-5-v1:0","inferenceProfileName":"US Claude Sonnet"},{"inferenceProfileId":"us.meta.llama","inferenceProfileName":"Llama"}]}`))
		case "/foundation-models":
			_, _ = w.Write([]byte(`{"modelSummaries":[{"modelId":"anthropic.claude-haiku-5-5-v1:0","modelName":"Claude Haiku"},{"modelId":"amazon.titan","modelName":"Titan"}]}`))
		}
	}))
	defer server.Close()
	models, err := ListModels(context.Background(), &Provider{Kind: KindBedrock, Region: "us-east-1", BaseURL: server.URL},
		&Credential{AccessKeyID: "AKIAEXAMPLEKEY0001", SecretAccessKey: "secret"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(seen, ",") != "/inference-profiles,/foundation-models" || len(models) != 2 ||
		models[0].ID != "us.anthropic.claude-sonnet-5-5-v1:0" || models[1].ID != "anthropic.claude-haiku-5-5-v1:0" {
		t.Fatalf("seen %v models %+v", seen, models)
	}
}
