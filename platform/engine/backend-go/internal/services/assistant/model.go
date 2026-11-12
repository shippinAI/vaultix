package assistant

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// ToolSpec is a tool offered to the model. Name is already model-safe.
type ToolSpec struct {
	Name        string
	Description string
	InputSchema json.RawMessage
}

// ToolCall is a model's request to run a tool.
type ToolCall struct {
	ID        string
	Name      string
	Arguments json.RawMessage
}

// ToolResult answers one tool call.
type ToolResult struct {
	CallID  string
	Content string
	IsError bool
}

// Turn is one entry in a conversation: a user message, an assistant reply
// (possibly asking for tools), or the results of those tools.
type Turn struct {
	Role      string // "user", "assistant" or "tool"
	Text      string
	ToolCalls []ToolCall
	Results   []ToolResult
}

type ChatRequest struct {
	System    string
	Turns     []Turn
	Tools     []ToolSpec
	MaxTokens int
}

type ChatResponse struct {
	Text      string
	ToolCalls []ToolCall
}

// Model is a configured provider ready to answer.
type Model interface {
	Chat(ctx context.Context, request *ChatRequest) (*ChatResponse, error)
}

// ProviderError is a failure reported by, or on the way to, the provider. Its
// message is safe to show to the instance administrator.
type ProviderError struct {
	Status  int
	Message string
}

func (e *ProviderError) Error() string { return e.Message }

const (
	anthropicVersion      = "2023-06-01"
	bedrockAnthropicBody  = "bedrock-2023-05-31"
	vertexAnthropicBody   = "vertex-2023-10-16"
	defaultAnthropicURL   = "https://api.anthropic.com"
	defaultOpenAIURL      = "https://api.openai.com/v1"
	maxProviderErrorBytes = 8 * 1024
	maxProviderBodyBytes  = 4 << 20
)

// HTTPClient is the outbound client. Redirects are refused so a credential is
// never replayed to a host the administrator did not configure.
func HTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// NewModel builds the adapter for a provider.
func NewModel(p *Provider, c *Credential, client *http.Client) (Model, error) {
	if client == nil {
		client = HTTPClient(90 * time.Second)
	}
	switch p.Kind {
	case KindAnthropic:
		base := p.BaseURL
		if base == "" {
			base = defaultAnthropicURL
		}
		return &anthropicModel{client: client, model: p.Model, url: base + "/v1/messages", sign: func(_ context.Context, r *http.Request, _ []byte) error {
			r.Header.Set("x-api-key", c.APIKey)
			r.Header.Set("anthropic-version", anthropicVersion)
			return nil
		}}, nil
	case KindBedrock:
		base := p.BaseURL
		if base == "" {
			base = "https://bedrock-runtime." + p.Region + ".amazonaws.com"
		}
		signer := v4.NewSigner()
		credentials := aws.Credentials{AccessKeyID: c.AccessKeyID, SecretAccessKey: c.SecretAccessKey, SessionToken: c.SessionToken}
		// The model ID can hold ':'; the path carries it escaped, as the AWS SDKs send it.
		escaped := strings.ReplaceAll(p.Model, ":", "%3A")
		return &anthropicModel{client: client, bodyVersion: bedrockAnthropicBody,
			url: base + "/model/" + escaped + "/invoke",
			sign: func(ctx context.Context, r *http.Request, body []byte) error {
				r.URL.RawPath = "/model/" + escaped + "/invoke"
				sum := sha256.Sum256(body)
				return signer.SignHTTP(ctx, credentials, r, hex.EncodeToString(sum[:]), "bedrock", p.Region, time.Now())
			}}, nil
	case KindVertex:
		host := "https://" + p.Region + "-aiplatform.googleapis.com"
		if p.Region == "global" {
			host = "https://aiplatform.googleapis.com"
		}
		if p.BaseURL != "" {
			host = p.BaseURL
		}
		return &anthropicModel{client: client, bodyVersion: vertexAnthropicBody,
			url: fmt.Sprintf("%s/v1/projects/%s/locations/%s/publishers/anthropic/models/%s:rawPredict", host, p.CloudProject, p.Region, p.Model),
			sign: func(ctx context.Context, r *http.Request, _ []byte) error {
				credentials, err := google.CredentialsFromJSON(context.WithValue(ctx, oauth2.HTTPClient, client), []byte(c.ServiceAccountJSON), "https://www.googleapis.com/auth/cloud-platform")
				if err != nil {
					return &ProviderError{Message: "The Google Cloud service account key could not be used."}
				}
				token, err := credentials.TokenSource.Token()
				if err != nil {
					return &ProviderError{Message: "Google Cloud refused the service account key."}
				}
				r.Header.Set("Authorization", "Bearer "+token.AccessToken)
				return nil
			}}, nil
	case KindOpenAI, KindOpenAICompatible:
		base := p.BaseURL
		if base == "" {
			base = defaultOpenAIURL
		}
		return &openAIModel{client: client, model: p.Model, url: base + "/chat/completions", key: c.APIKey,
			completionTokens: p.Kind == KindOpenAI}, nil
	}
	return nil, fmt.Errorf("unknown provider kind %q", p.Kind)
}

func post(ctx context.Context, client *http.Client, url string, body []byte, prepare func(*http.Request) error) ([]byte, error) {
	return send(ctx, client, http.MethodPost, url, body, prepare)
}

func send(ctx context.Context, client *http.Client, method, url string, body []byte, prepare func(*http.Request) error) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	r, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return nil, &ProviderError{Message: "The provider address is not valid."}
	}
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Accept", "application/json")
	if err := prepare(r); err != nil {
		var providerErr *ProviderError
		if errors.As(err, &providerErr) {
			return nil, err
		}
		return nil, &ProviderError{Message: "The request to the provider could not be signed."}
	}
	response, err := client.Do(r)
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
			return nil, &ProviderError{Status: http.StatusGatewayTimeout, Message: "The provider did not answer in time."}
		}
		return nil, &ProviderError{Status: http.StatusBadGateway, Message: "The provider could not be reached."}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, maxProviderErrorBytes))
		return nil, providerFailure(response.StatusCode, raw)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxProviderBodyBytes))
	if err != nil {
		return nil, &ProviderError{Status: http.StatusBadGateway, Message: "The provider's answer could not be read."}
	}
	return raw, nil
}

// providerFailure turns an error answer into a message for the administrator.
// Provider error bodies describe the request, not the credential.
func providerFailure(status int, raw []byte) *ProviderError {
	var body struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	detail := ""
	if json.Unmarshal(raw, &body) == nil {
		var nested struct {
			Message string `json:"message"`
		}
		var flat string
		switch {
		case json.Unmarshal(body.Error, &nested) == nil && nested.Message != "":
			detail = nested.Message
		case json.Unmarshal(body.Error, &flat) == nil && flat != "":
			detail = flat
		case body.Message != "":
			detail = body.Message
		}
	}
	prefix := fmt.Sprintf("The provider answered %d", status)
	switch status {
	case http.StatusUnauthorized, http.StatusForbidden:
		prefix = "The provider refused the credential"
	case http.StatusNotFound:
		prefix = "The provider does not know this model or address"
	case http.StatusTooManyRequests:
		prefix = "The provider is rate limiting this account"
	}
	if detail != "" {
		if len(detail) > 200 {
			detail = detail[:200]
		}
		return &ProviderError{Status: status, Message: prefix + ": " + detail}
	}
	return &ProviderError{Status: status, Message: prefix + "."}
}

type anthropicModel struct {
	client      *http.Client
	url         string
	model       string // sent in the body only by the direct API
	bodyVersion string // anthropic_version in the body, for Bedrock and Vertex
	sign        func(context.Context, *http.Request, []byte) error
}

type anthropicBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   string          `json:"content,omitempty"`
	IsError   bool            `json:"is_error,omitempty"`
}

type anthropicMessage struct {
	Role    string           `json:"role"`
	Content []anthropicBlock `json:"content"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

func (m *anthropicModel) Chat(ctx context.Context, request *ChatRequest) (*ChatResponse, error) {
	messages := make([]anthropicMessage, 0, len(request.Turns))
	for _, turn := range request.Turns {
		switch turn.Role {
		case "user":
			messages = append(messages, anthropicMessage{Role: "user", Content: []anthropicBlock{{Type: "text", Text: turn.Text}}})
		case "assistant":
			blocks := []anthropicBlock{}
			if turn.Text != "" {
				blocks = append(blocks, anthropicBlock{Type: "text", Text: turn.Text})
			}
			for _, call := range turn.ToolCalls {
				blocks = append(blocks, anthropicBlock{Type: "tool_use", ID: call.ID, Name: call.Name, Input: objectOrEmpty(call.Arguments)})
			}
			messages = append(messages, anthropicMessage{Role: "assistant", Content: blocks})
		case "tool":
			blocks := make([]anthropicBlock, 0, len(turn.Results))
			for _, result := range turn.Results {
				blocks = append(blocks, anthropicBlock{Type: "tool_result", ToolUseID: result.CallID, Content: result.Content, IsError: result.IsError})
			}
			messages = append(messages, anthropicMessage{Role: "user", Content: blocks})
		}
	}
	body := map[string]any{"max_tokens": request.MaxTokens, "system": request.System, "messages": messages}
	if len(request.Tools) > 0 {
		tools := make([]anthropicTool, 0, len(request.Tools))
		for _, tool := range request.Tools {
			tools = append(tools, anthropicTool{Name: tool.Name, Description: tool.Description, InputSchema: objectOrEmpty(tool.InputSchema)})
		}
		body["tools"] = tools
	}
	if m.bodyVersion != "" {
		body["anthropic_version"] = m.bodyVersion
	} else {
		body["model"] = m.model
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, &ProviderError{Message: "The request could not be encoded."}
	}
	raw, err := post(ctx, m.client, m.url, encoded, func(r *http.Request) error { return m.sign(ctx, r, encoded) })
	if err != nil {
		return nil, err
	}
	var answer struct {
		Content []anthropicBlock `json:"content"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return nil, &ProviderError{Status: http.StatusBadGateway, Message: "The provider's answer was not in the Anthropic Messages format."}
	}
	response := &ChatResponse{}
	var text []string
	for _, block := range answer.Content {
		switch block.Type {
		case "text":
			text = append(text, block.Text)
		case "tool_use":
			response.ToolCalls = append(response.ToolCalls, ToolCall{ID: block.ID, Name: block.Name, Arguments: objectOrEmpty(block.Input)})
		}
	}
	response.Text = strings.Join(text, "\n")
	return response, nil
}

type openAIModel struct {
	client           *http.Client
	url              string
	model            string
	key              string
	completionTokens bool // OpenAI's own API takes max_completion_tokens
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    *string          `json:"content"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

func (m *openAIModel) Chat(ctx context.Context, request *ChatRequest) (*ChatResponse, error) {
	text := func(s string) *string { return &s }
	messages := []openAIMessage{{Role: "system", Content: text(request.System)}}
	for _, turn := range request.Turns {
		switch turn.Role {
		case "user":
			messages = append(messages, openAIMessage{Role: "user", Content: text(turn.Text)})
		case "assistant":
			message := openAIMessage{Role: "assistant"}
			if turn.Text != "" {
				message.Content = text(turn.Text)
			}
			for _, call := range turn.ToolCalls {
				tc := openAIToolCall{ID: call.ID, Type: "function"}
				tc.Function.Name = call.Name
				tc.Function.Arguments = string(objectOrEmpty(call.Arguments))
				message.ToolCalls = append(message.ToolCalls, tc)
			}
			messages = append(messages, message)
		case "tool":
			for _, result := range turn.Results {
				content := result.Content
				if result.IsError {
					content = "Error: " + content
				}
				messages = append(messages, openAIMessage{Role: "tool", ToolCallID: result.CallID, Content: text(content)})
			}
		}
	}
	body := map[string]any{"model": m.model, "messages": messages}
	if m.completionTokens {
		body["max_completion_tokens"] = request.MaxTokens
	} else {
		body["max_tokens"] = request.MaxTokens
	}
	if len(request.Tools) > 0 {
		tools := make([]map[string]any, 0, len(request.Tools))
		for _, tool := range request.Tools {
			tools = append(tools, map[string]any{"type": "function", "function": map[string]any{
				"name": tool.Name, "description": tool.Description, "parameters": objectOrEmpty(tool.InputSchema),
			}})
		}
		body["tools"] = tools
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, &ProviderError{Message: "The request could not be encoded."}
	}
	raw, err := post(ctx, m.client, m.url, encoded, func(r *http.Request) error {
		if m.key != "" {
			r.Header.Set("Authorization", "Bearer "+m.key)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	var answer struct {
		Choices []struct {
			Message struct {
				Content   *string          `json:"content"`
				ToolCalls []openAIToolCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil || len(answer.Choices) == 0 {
		return nil, &ProviderError{Status: http.StatusBadGateway, Message: "The provider's answer was not in the chat completions format."}
	}
	message := answer.Choices[0].Message
	response := &ChatResponse{}
	if message.Content != nil {
		response.Text = *message.Content
	}
	for _, call := range message.ToolCalls {
		arguments := json.RawMessage(call.Function.Arguments)
		if !json.Valid(arguments) {
			arguments = json.RawMessage(`{}`)
		}
		response.ToolCalls = append(response.ToolCalls, ToolCall{ID: call.ID, Name: call.Function.Name, Arguments: arguments})
	}
	return response, nil
}

func objectOrEmpty(raw json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '{' || !json.Valid(trimmed) {
		return json.RawMessage(`{}`)
	}
	return trimmed
}
