package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// ---- Admin endpoints ----

// webSearchConfigResponse is returned to admin users with configured status.
type webSearchConfigResponse struct {
	Enabled    bool `json:"enabled"`
	Configured bool `json:"configured"`
}

func (s *Server) handleAdminGetWebSearchConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Store.GetWebSearchConfig()
	if err != nil {
		internalError(w, r, "Failed to load web search config", err)
		return
	}

	resp := webSearchConfigResponse{
		Enabled:    cfg != nil && cfg.Enabled,
		Configured: cfg != nil && cfg.APIKey != "",
	}
	jsonResponse(w, resp, http.StatusOK)
}

func (s *Server) handleAdminSetWebSearchConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		APIKey  string `json:"apiKey"`
		Enabled bool   `json:"enabled"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// An empty apiKey keeps the existing one (store handles that), but we must
	// not allow enabling the feature with no key configured at all.
	existing, err := s.Store.GetWebSearchConfig()
	if err != nil {
		internalError(w, r, "Failed to load web search config", err)
		return
	}
	existingKey := ""
	if existing != nil {
		existingKey = existing.APIKey
	}
	if req.APIKey == "" && existingKey == "" && req.Enabled {
		errorResponse(w, "API key is required to enable web search", http.StatusBadRequest)
		return
	}

	if err := s.Store.UpsertWebSearchConfig(&store.WebSearchConfig{
		APIKey:  req.APIKey,
		Enabled: req.Enabled,
	}); err != nil {
		internalError(w, r, "Failed to save web search config", err)
		return
	}
	auditLog(r, "web_search_config.set", "", "enabled", req.Enabled)

	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// ---- Search Tool Definition ----

// searchToolInputSchema is the JSON Schema for the web_search tool's query parameter.
const searchToolInputSchema = `{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "The search query to look up on the web"
    }
  },
  "required": ["query"]
}`

// buildSearchToolDefinition returns the tool definition for web search.
func buildSearchToolDefinition() []ai.ToolDefinition {
	return []ai.ToolDefinition{
		{
			Name:        "web_search",
			Description: "Search the web for current, up-to-date information. Use this when the user asks for recent events, real-time data, or any information that may have changed since your training data cutoff.",
			InputSchema: searchToolInputSchema,
		},
	}
}

// ---- Public endpoint ----

// webSearchPublicResponse is returned to authenticated users — no API key exposed.
type webSearchPublicResponse struct {
	Enabled bool `json:"enabled"`
}

func (s *Server) handleWebSearchConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.Store.GetWebSearchConfig()
	if err != nil {
		// If we can't load config, treat as disabled — don't break the frontend.
		slog.Error("Failed to load web search config for public endpoint", "error", err)
		jsonResponse(w, webSearchPublicResponse{Enabled: false}, http.StatusOK)
		return
	}
	jsonResponse(w, webSearchPublicResponse{
		Enabled: cfg != nil && cfg.Enabled && cfg.APIKey != "",
	}, http.StatusOK)
}

// ---- Brave Search Integration ----

// braveSearchResult holds the formatted search results from Brave.
type braveSearchResult struct {
	Results string // Formatted text with search results
}

// callBraveSearch performs a Brave Web Search API call with the given query.
// Always sends units=metric and safesearch=off as per requirements.
func callBraveSearch(apiKey, query string, count int) (*braveSearchResult, error) {
	if count <= 0 || count > 20 {
		count = 10
	}

	params := url.Values{}
	params.Set("q", query)
	params.Set("count", fmt.Sprintf("%d", count))
	params.Set("units", "metric")
	params.Set("safesearch", "off")

	reqURL := "https://api.search.brave.com/res/v1/web/search?" + params.Encode()

	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	// NOTE: do NOT set "Accept-Encoding: gzip" manually — Go's http.Transport
	// only decompresses gzip transparently when it adds the header itself.
	req.Header.Set("X-Subscription-Token", apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("brave search request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("brave search returned %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read brave response: %w", err)
	}

	var braveResp struct {
		Query struct {
			Original string `json:"original"`
		} `json:"query"`
		Web *struct {
			Results []struct {
				Title   string `json:"title"`
				URL     string `json:"url"`
				Snippet string `json:"description"`
			} `json:"results"`
		} `json:"web"`
		News *struct {
			Results []struct {
				Title   string `json:"title"`
				URL     string `json:"url"`
				Snippet string `json:"description"`
				Age     string `json:"age"`
				Source  string `json:"source"`
			} `json:"results"`
		} `json:"news"`
	}

	if err := json.Unmarshal(body, &braveResp); err != nil {
		return nil, fmt.Errorf("parse brave response: %w", err)
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Web search results for query: %s\n\n", braveResp.Query.Original))

	if braveResp.Web != nil && len(braveResp.Web.Results) > 0 {
		sb.WriteString("=== Web Results ===\n")
		for i, r := range braveResp.Web.Results {
			sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, r.Title))
			sb.WriteString(fmt.Sprintf("   URL: %s\n", r.URL))
			sb.WriteString(fmt.Sprintf("   Snippet: %s\n", r.Snippet))
			sb.WriteString("\n")
		}
	}

	if braveResp.News != nil && len(braveResp.News.Results) > 0 {
		sb.WriteString("=== News Results ===\n")
		for i, r := range braveResp.News.Results {
			sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, r.Title))
			sb.WriteString(fmt.Sprintf("   Source: %s\n", r.Source))
			sb.WriteString(fmt.Sprintf("   Age: %s\n", r.Age))
			sb.WriteString(fmt.Sprintf("   URL: %s\n", r.URL))
			sb.WriteString(fmt.Sprintf("   Snippet: %s\n", r.Snippet))
			sb.WriteString("\n")
		}
	}

	return &braveSearchResult{Results: sb.String()}, nil
}

// searchPrompt returns a system prompt section instructing the model
// that web search via tool calling is available.
func (s *Server) buildSearchSystemPrompt() string {
	return `

---

VII. Web Research

You have access to the "web_search" tool. Use it to search the web for current, up-to-date information whenever the user asks about recent events, real-time data, or any topic that may require recent knowledge. When you receive search results, synthesize them and cite sources by URL. Do not claim that you lack internet access or browsing capability — the tool is available for you to use.`
}
