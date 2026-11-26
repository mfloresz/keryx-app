package api

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// Agent bundle resolution: an agent's Tools/Skills/Knowledge fields shape the
// chat run. The helpers here are kept pure (or store-lookup-thin) so they can
// be unit-tested without a provider.

// Headers used when injecting preloaded skill instructions into the prompt.
const (
	skillHeaderBound  = "Skill"                  // bound to the agent (### Skill: <name>)
	skillHeaderPinned = "Skill (user-requested)" // pinned for this run by the client
)

// knowledgeBudgetChars caps the total characters of agent knowledge injected
// into the prompt: a quarter of the default context budget.
const knowledgeBudgetChars = ai.DefaultContextBudgetChars / 4

// agentToolAllowed reports whether a tool may be registered given the agent's
// Tools whitelist. An empty whitelist means "agent defaults", i.e. every
// agent-selectable tool keeps its current behavior. Project tools and
// load_skill are not agent-selectable and never consult this.
func agentToolAllowed(tool string, agentTools []string) bool {
	if len(agentTools) == 0 {
		return true
	}
	return slices.Contains(agentTools, tool)
}

// renderSkillSections renders preloaded skill instructions as prompt
// sections, one per skill: "\n\n### <header>: <name>\n<instructions>".
func renderSkillSections(skills []store.Skill, header string) string {
	var b strings.Builder
	for _, sk := range skills {
		fmt.Fprintf(&b, "\n\n### %s: %s\n%s", header, sk.Name, sk.Instructions)
	}
	return b.String()
}

// resolveAgentSkills resolves skill names to enabled skills, in order.
// Unknown or disabled names are skipped (a deleted skill never breaks a run).
func (s *Server) resolveAgentSkills(names []string) []store.Skill {
	var out []store.Skill
	for _, name := range names {
		sk, err := s.Store.GetSkillByName(name)
		if err != nil || !sk.Enabled {
			continue
		}
		out = append(out, *sk)
	}
	return out
}

// knowledgeFile is one text-ish knowledge attachment ready for prompt
// injection.
type knowledgeFile struct {
	Filename  string
	MediaType string
	Text      string
}

// formatFileBlock renders a knowledge file as a labeled block for prompts.
// Mirrors ai.formatFileBlock (unexported there).
func formatFileBlock(filename, mediaType, text string) string {
	return fmt.Sprintf("<file name=%q media=%s>\n%s\n</file>", filename, mediaType, text)
}

// capKnowledgeFiles keeps a prefix of files whose combined text fits budget
// chars; the first file that does not fit ends the section (everything after
// it is dropped). ponytail: whole-file granularity — a slightly larger
// per-file truncation scheme is not worth it until real agents hit the cap.
func capKnowledgeFiles(files []knowledgeFile, budget int) []knowledgeFile {
	used := 0
	for i, f := range files {
		if used+len(f.Text) > budget {
			return files[:i]
		}
		used += len(f.Text)
	}
	return files
}

// buildKnowledgeSection renders the "### Knowledge" prompt section.
func buildKnowledgeSection(files []knowledgeFile) string {
	if len(files) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\n\n---\n\n### Knowledge\nReference documents attached to the agent:\n")
	for _, f := range files {
		b.WriteString("\n" + formatFileBlock(f.Filename, f.MediaType, f.Text) + "\n")
	}
	return b.String()
}

// loadAgentKnowledge resolves an agent's knowledge attachment ids into text
// blocks, owner-scoped to ownerID. Policy: knowledge files are owned by the
// user who uploaded them, so only user-owned agents carry usable knowledge —
// builtin catalog agents have none and global customs' files resolve only for
// their uploading owner. Markdown conversions (ai.MarkdownAttachmentBudget
// chars) are preferred; text media types fall back to raw bytes; binaries are
// skipped. The section is capped at knowledgeBudgetChars.
func (s *Server) loadAgentKnowledge(ids []string, ownerID string) []knowledgeFile {
	var files []knowledgeFile
	for _, id := range ids {
		info, data, err := s.Store.GetAttachmentData(id, ownerID)
		if err != nil {
			continue
		}
		var text, media string
		if md, err := s.Store.GetAttachmentMarkdown(id, ownerID, ai.MarkdownAttachmentBudget*utf8.UTFMax); err == nil && md != "" {
			text, media = ai.TruncateText(md, ai.MarkdownAttachmentBudget), "text/markdown"
		} else if len(data) > 0 && isTextMedia(info.MediaType) {
			text, media = string(data), info.MediaType
		}
		if text == "" {
			continue // binary (or unreadable): skipped
		}
		files = append(files, knowledgeFile{Filename: info.Filename, MediaType: media, Text: text})
	}
	return capKnowledgeFiles(files, knowledgeBudgetChars)
}

// agentKnowledgeSection builds the "### Knowledge" prompt section for an
// agent's bound knowledge (empty when the agent has none or nothing resolves).
func (s *Server) agentKnowledgeSection(ag *store.Agent, ownerID string) string {
	if len(ag.Knowledge) == 0 {
		return ""
	}
	return buildKnowledgeSection(s.loadAgentKnowledge(ag.Knowledge, ownerID))
}

// isTextMedia reports whether a media type carries human-readable text.
// Mirrors ai.isTextMedia (unexported there).
func isTextMedia(mediaType string) bool {
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/xml", "application/javascript",
		"application/typescript", "application/x-sh", "application/yaml",
		"image/svg+xml":
		return true
	}
	return false
}

// renderTaskPrompt substitutes the automation task prompt's {date} and {time}
// placeholders with the server-local now (2006-01-02 / 15:04).
func renderTaskPrompt(prompt string, now time.Time) string {
	prompt = strings.ReplaceAll(prompt, "{date}", now.Format("2006-01-02"))
	prompt = strings.ReplaceAll(prompt, "{time}", now.Format("15:04"))
	return prompt
}

// maxPinnedSkills bounds how many skills a client may pin per stream request.
const maxPinnedSkills = 5
