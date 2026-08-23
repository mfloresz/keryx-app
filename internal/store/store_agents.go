package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"keryx-server/internal/config"
)

// AgentSource describes where an effective agent comes from.
type AgentSource string

const (
	AgentSourceBuiltin     AgentSource = "builtin"
	AgentSourceOverride    AgentSource = "override"
	AgentSourceGlobalCustom AgentSource = "global_custom"
	AgentSourceUserCustom  AgentSource = "user_custom"
)

// Agent is an effective agent (merged view of catalog + DB).
type Agent struct {
	ID           string      `json:"id"`
	BuiltinID    string      `json:"builtinId,omitempty"`
	OwnerID      string      `json:"ownerId,omitempty"`
	Name         string      `json:"name"`
	Description  string      `json:"description,omitempty"`
	Icon         string      `json:"icon,omitempty"`
	SystemPrompt string      `json:"systemPrompt"`
	Source       AgentSource `json:"source"`
	CreatedAt    string      `json:"createdAt,omitempty"`
	UpdatedAt    string      `json:"updatedAt,omitempty"`
}

const maxAgentsPerUser = 50

func agentFromRecord(r *core.Record) *Agent {
	return &Agent{
		ID:           r.Id,
		BuiltinID:    r.GetString("builtin_id"),
		OwnerID:      r.GetString("owner"),
		Name:         r.GetString("name"),
		Description:  r.GetString("description"),
		Icon:         r.GetString("icon"),
		SystemPrompt: r.GetString("system_prompt"),
		CreatedAt:    r.GetString("created"),
		UpdatedAt:    r.GetString("updated"),
	}
}

func (s *Store) findAgentRecord(filter string, params dbx.Params) (*core.Record, error) {
	return s.App.FindFirstRecordByFilter(AgentsCollection, filter, params)
}

// ListEffectiveAgents returns the merged agent list visible to userID:
// embedded catalog (with global overrides applied), global customs, and the
// user's private agents. Admins additionally see who owns what via OwnerID.
func (s *Store) ListEffectiveAgents(userID string, isAdmin bool) ([]Agent, error) {
	byKey := make(map[string]*Agent)

	// 1. Embedded catalog as baseline.
	for _, ba := range config.DefaultAgents {
		byKey[ba.ID] = &Agent{
			ID:           ba.ID,
			BuiltinID:    ba.ID,
			Name:         ba.Name,
			Description:  ba.Description,
			Icon:         ba.Icon,
			SystemPrompt: ba.SystemPrompt,
			Source:       AgentSourceBuiltin,
		}
	}

	// 2. Global records override the catalog or add global customs.
	globals, err := s.App.FindRecordsByFilter(
		AgentsCollection,
		"owner = null || owner = ''",
		"-created",
		500, 0,
		nil,
	)
	if err != nil {
		return nil, err
	}
	for _, r := range globals {
		ag := agentFromRecord(r)
		if ag.BuiltinID != "" {
			ag.ID = ag.BuiltinID
			ag.Source = AgentSourceOverride
		} else {
			ag.Source = AgentSourceGlobalCustom
		}
		byKey[ag.ID] = ag
	}

	// 3. The user's private agents.
	if userID != "" {
		mine, err := s.App.FindRecordsByFilter(
			AgentsCollection,
			"owner = {:owner}",
			"-created",
			500, 0,
			dbx.Params{"owner": userID},
		)
		if err != nil {
			return nil, err
		}
		for _, r := range mine {
			ag := agentFromRecord(r)
			ag.Source = AgentSourceUserCustom
			byKey["user:"+ag.ID] = ag
		}
	}

	out := make([]Agent, 0, len(byKey))
	for _, ag := range byKey {
		out = append(out, *ag)
	}
	return out, nil
}

// GetAgentForStream resolves an agent by ID for a given user, validating
// visibility (global records by record ID or builtin_id, private by record ID).
func (s *Store) GetAgentForStream(agentID, userID string) (*Agent, error) {
	// Direct record hit (global or owned).
	record, err := s.findAgentRecord(
		"id = {:id} && (owner = null || owner = '' || owner = {:owner})",
		dbx.Params{"id": agentID, "owner": userID},
	)
	if err == nil {
		ag := agentFromRecord(record)
		if ag.BuiltinID != "" {
			ag.ID = ag.BuiltinID
			ag.Source = AgentSourceOverride
		} else if ag.OwnerID != "" {
			ag.Source = AgentSourceUserCustom
		} else {
			ag.Source = AgentSourceGlobalCustom
		}
		return ag, nil
	}

	// Builtin catalog hit (possibly with a global override).
	for _, ba := range config.DefaultAgents {
		if ba.ID != agentID {
			continue
		}
		ag := &Agent{
			ID:           ba.ID,
			BuiltinID:    ba.ID,
			Name:         ba.Name,
			Description:  ba.Description,
			Icon:         ba.Icon,
			SystemPrompt: ba.SystemPrompt,
			Source:       AgentSourceBuiltin,
		}
		if ov, ovErr := s.findAgentRecord(
			"builtin_id = {:bid} && (owner = null || owner = '')",
			dbx.Params{"bid": agentID},
		); ovErr == nil {
			ag.Name = ov.GetString("name")
			ag.Description = ov.GetString("description")
			ag.Icon = ov.GetString("icon")
			ag.SystemPrompt = ov.GetString("system_prompt")
			ag.Source = AgentSourceOverride
		}
		return ag, nil
	}
	return nil, ErrNotFound
}

// CreateAgent inserts a new agent record. ownerID empty = global (admin only,
// enforced by callers). builtinID non-empty creates a catalog override.
func (s *Store) CreateAgent(ag *Agent, ownerID, builtinID string) (*Agent, error) {
	if len(ag.Name) == 0 || len(ag.Name) > 80 {
		return nil, ErrInvalid
	}
	if len(ag.SystemPrompt) == 0 || len(ag.SystemPrompt) > 10000 {
		return nil, ErrInvalid
	}
	if len(ag.Description) > 300 || len(ag.Icon) > 40 || len(builtinID) > 80 {
		return nil, ErrInvalid
	}

	if ownerID != "" {
		count, err := s.App.CountRecords(AgentsCollection, dbx.NewExp("owner = {:o}", dbx.Params{"o": ownerID}))
		if err != nil {
			return nil, err
		}
		if count >= maxAgentsPerUser {
			return nil, ErrLimitReached
		}
	}

	collection, err := s.App.FindCollectionByNameOrId(AgentsCollection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("builtin_id", builtinID)
	if ownerID != "" {
		record.Set("owner", ownerID)
	}
	record.Set("name", ag.Name)
	record.Set("description", ag.Description)
	record.Set("icon", ag.Icon)
	record.Set("system_prompt", ag.SystemPrompt)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return agentFromRecord(record), nil
}

// UpdateAgent edits an existing record. Only the owner (or admin for globals)
// may update; authorization is enforced by callers, here we just locate and save.
func (s *Store) UpdateAgent(id string, mutate func(*Agent) (*Agent, error)) (*Agent, error) {
	record, err := s.App.FindRecordById(AgentsCollection, id)
	if err != nil {
		return nil, ErrNotFound
	}
	current := agentFromRecord(record)
	next, err := mutate(current)
	if err != nil {
		return nil, err
	}
	if len(next.Name) == 0 || len(next.Name) > 80 {
		return nil, ErrInvalid
	}
	if len(next.SystemPrompt) == 0 || len(next.SystemPrompt) > 10000 {
		return nil, ErrInvalid
	}
	record.Set("name", next.Name)
	record.Set("description", next.Description)
	record.Set("icon", next.Icon)
	record.Set("system_prompt", next.SystemPrompt)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return agentFromRecord(record), nil
}

// DeleteAgent removes a record. Deleting a builtin override resets to catalog;
// deleting a custom removes it. Chats referencing it degrade gracefully.
func (s *Store) DeleteAgent(id string) error {
	record, err := s.App.FindRecordById(AgentsCollection, id)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

// GetAgentRecord loads the raw record for authorization checks in handlers.
func (s *Store) GetAgentRecord(id string) (*core.Record, error) {
	return s.App.FindRecordById(AgentsCollection, id)
}

// DuplicateAgent copies a global agent (or catalog builtin) into a private
// copy owned by userID.
func (s *Store) DuplicateAgent(fromID, userID string) (*Agent, error) {
	src, err := s.GetAgentForStream(fromID, userID)
	if err != nil {
		return nil, err
	}
	return s.CreateAgent(&Agent{
		Name:         src.Name + " (copia)",
		Description:  src.Description,
		Icon:         src.Icon,
		SystemPrompt: src.SystemPrompt,
	}, userID, "")
}
