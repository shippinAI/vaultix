package assistant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// ModelInfo is one model a provider says it offers.
type ModelInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const (
	maxListedModels = 500
	maxModelPages   = 5
)

// OpenAI lists every model the key can use, including ones that cannot chat.
var openAINonChat = []string{"embedding", "tts", "whisper", "dall-e", "moderation", "davinci", "babbage",
	"transcribe", "image", "audio", "realtime", "search"}

// ListModels asks the provider which models this credential can use. The
// administrator still types any model ID the provider accepts; the list is a
// convenience and is never cached.
func ListModels(ctx context.Context, p *Provider, c *Credential, client *http.Client) ([]ModelInfo, error) {
	if client == nil {
		client = HTTPClient(30 * time.Second)
	}
	var models []ModelInfo
	var err error
	switch p.Kind {
	case KindAnthropic:
		models, err = listAnthropic(ctx, p, c, client)
	case KindOpenAI, KindOpenAICompatible:
		models, err = listOpenAI(ctx, p, c, client)
	case KindBedrock:
		models, err = listBedrock(ctx, p, c, client)
	case KindVertex:
		models, err = listVertex(ctx, p, c, client)
	default:
		return nil, &ProviderError{Message: "This provider kind cannot list models."}
	}
	if err != nil {
		return nil, err
	}
	if len(models) > maxListedModels {
		models = models[:maxListedModels]
	}
	return models, nil
}

func listAnthropic(ctx context.Context, p *Provider, c *Credential, client *http.Client) ([]ModelInfo, error) {
	base := p.BaseURL
	if base == "" {
		base = defaultAnthropicURL
	}
	models := []ModelInfo{}
	after := ""
	for page := 0; page < maxModelPages; page++ {
		query := url.Values{"limit": {"1000"}}
		if after != "" {
			query.Set("after_id", after)
		}
		raw, err := send(ctx, client, http.MethodGet, base+"/v1/models?"+query.Encode(), nil, func(r *http.Request) error {
			r.Header.Set("x-api-key", c.APIKey)
			r.Header.Set("anthropic-version", anthropicVersion)
			return nil
		})
		if err != nil {
			return nil, err
		}
		var body struct {
			Data []struct {
				ID          string `json:"id"`
				DisplayName string `json:"display_name"`
			} `json:"data"`
			HasMore bool   `json:"has_more"`
			LastID  string `json:"last_id"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			return nil, &ProviderError{Message: "The provider's model list could not be read."}
		}
		for _, m := range body.Data {
			models = append(models, ModelInfo{ID: m.ID, Name: m.DisplayName})
		}
		if !body.HasMore || body.LastID == "" {
			break
		}
		after = body.LastID
	}
	return models, nil
}

func listOpenAI(ctx context.Context, p *Provider, c *Credential, client *http.Client) ([]ModelInfo, error) {
	base := p.BaseURL
	if base == "" {
		base = defaultOpenAIURL
	}
	raw, err := send(ctx, client, http.MethodGet, base+"/models", nil, func(r *http.Request) error {
		if c.APIKey != "" {
			r.Header.Set("Authorization", "Bearer "+c.APIKey)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, &ProviderError{Message: "The provider's model list could not be read."}
	}
	models := []ModelInfo{}
next:
	for _, m := range body.Data {
		if p.Kind == KindOpenAI {
			for _, skip := range openAINonChat {
				if strings.Contains(m.ID, skip) {
					continue next
				}
			}
		}
		models = append(models, ModelInfo{ID: m.ID, Name: m.ID})
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

// listBedrock returns Anthropic's foundation models and the inference profiles
// that route to them; newer Claude models are invoked through a profile.
func listBedrock(ctx context.Context, p *Provider, c *Credential, client *http.Client) ([]ModelInfo, error) {
	base := p.BaseURL
	if base == "" {
		base = "https://bedrock." + p.Region + ".amazonaws.com"
	}
	signer := v4.NewSigner()
	credentials := aws.Credentials{AccessKeyID: c.AccessKeyID, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken}
	empty := sha256.Sum256(nil)
	sign := func(r *http.Request) error {
		return signer.SignHTTP(r.Context(), credentials, r, hex.EncodeToString(empty[:]), "bedrock", p.Region, time.Now())
	}
	models := []ModelInfo{}
	profiles, err := send(ctx, client, http.MethodGet, base+"/inference-profiles?maxResults=1000&type=SYSTEM_DEFINED", nil, sign)
	if err == nil {
		var body struct {
			Summaries []struct {
				ID   string `json:"inferenceProfileId"`
				Name string `json:"inferenceProfileName"`
			} `json:"inferenceProfileSummaries"`
		}
		if json.Unmarshal(profiles, &body) == nil {
			for _, s := range body.Summaries {
				if strings.Contains(s.ID, "anthropic.") {
					models = append(models, ModelInfo{ID: s.ID, Name: s.Name})
				}
			}
		}
	}
	raw, err := send(ctx, client, http.MethodGet, base+"/foundation-models", nil, sign)
	if err != nil {
		if len(models) > 0 {
			return models, nil
		}
		return nil, err
	}
	var body struct {
		Summaries []struct {
			ID   string `json:"modelId"`
			Name string `json:"modelName"`
		} `json:"modelSummaries"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, &ProviderError{Message: "The provider's model list could not be read."}
	}
	for _, s := range body.Summaries {
		if strings.HasPrefix(s.ID, "anthropic.") {
			models = append(models, ModelInfo{ID: s.ID, Name: s.Name})
		}
	}
	return models, nil
}

func listVertex(ctx context.Context, p *Provider, c *Credential, client *http.Client) ([]ModelInfo, error) {
	host := "https://" + p.Region + "-aiplatform.googleapis.com"
	if p.Region == "global" {
		host = "https://aiplatform.googleapis.com"
	}
	if p.BaseURL != "" {
		host = p.BaseURL
	}
	raw, err := send(ctx, client, http.MethodGet, host+"/v1beta1/publishers/anthropic/models?pageSize=100", nil, func(r *http.Request) error {
		credentials, err := google.CredentialsFromJSON(context.WithValue(ctx, oauth2.HTTPClient, client), []byte(c.ServiceAccountJSON), "https://www.googleapis.com/auth/cloud-platform")
		if err != nil {
			return &ProviderError{Message: "The Google Cloud service account key could not be used."}
		}
		token, err := credentials.TokenSource.Token()
		if err != nil {
			return &ProviderError{Message: "Google Cloud refused the service account key."}
		}
		r.Header.Set("Authorization", "Bearer "+token.AccessToken)
		r.Header.Set("x-goog-user-project", p.CloudProject)
		return nil
	})
	if err != nil {
		return nil, err
	}
	var body struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"publisherModels"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, &ProviderError{Message: "The provider's model list could not be read."}
	}
	models := []ModelInfo{}
	for _, m := range body.Models {
		id := m.Name[strings.LastIndex(m.Name, "/")+1:]
		if id != "" {
			models = append(models, ModelInfo{ID: id, Name: id})
		}
	}
	return models, nil
}
