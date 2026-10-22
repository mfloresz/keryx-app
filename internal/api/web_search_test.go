package api

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestParseBraveResponseCollectsCitations verifies the Brave payload is
// turned into both the formatted text (for the model) and the citations
// (for the client's source list).
func TestParseBraveResponseCollectsCitations(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"query": map[string]any{"original": "keryx"},
		"web": map[string]any{
			"results": []map[string]any{
				{"title": "First result", "url": "https://a.example", "description": "First snippet"},
				{"title": "Second result", "url": "https://b.example", "description": "Second snippet"},
			},
		},
		"news": map[string]any{
			"results": []map[string]any{
				{"title": "News item", "url": "https://c.example", "description": "News snippet", "source": "Wire", "age": "1h"},
			},
		},
	})

	result, err := parseBraveResponse(payload)
	if err != nil {
		t.Fatalf("parseBraveResponse: %v", err)
	}

	if len(result.Citations) != 3 {
		t.Fatalf("expected 3 citations, got %d: %+v", len(result.Citations), result.Citations)
	}
	if result.Citations[0].Title != "First result" || result.Citations[0].URL != "https://a.example" {
		t.Errorf("unexpected first citation: %+v", result.Citations[0])
	}
	if result.Citations[2].Title != "News item" || result.Citations[2].URL != "https://c.example" {
		t.Errorf("unexpected news citation: %+v", result.Citations[2])
	}

	// The model still gets the URLs in the text it receives.
	for _, want := range []string{"https://a.example", "https://b.example", "https://c.example", "First result"} {
		if !strings.Contains(result.Results, want) {
			t.Errorf("expected the formatted results to contain %q, got:\n%s", want, result.Results)
		}
	}
}

// TestParseBraveResponseWithoutResults makes sure an empty response does not
// break the tool.
func TestParseBraveResponseWithoutResults(t *testing.T) {
	payload, _ := json.Marshal(map[string]any{
		"query": map[string]any{"original": "nada"},
	})

	result, err := parseBraveResponse(payload)
	if err != nil {
		t.Fatalf("parseBraveResponse: %v", err)
	}
	if len(result.Citations) != 0 {
		t.Fatalf("expected no citations, got %d", len(result.Citations))
	}
	if !strings.Contains(result.Results, "nada") {
		t.Errorf("expected the query in the results, got:\n%s", result.Results)
	}
}
