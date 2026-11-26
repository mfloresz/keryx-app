package store

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const maxAutomationsPerUser = 20

// Automation run statuses stored in automation_runs.status.
const (
	AutomationRunStatusSuccess = "success"
	AutomationRunStatusError   = "error"
)

// Automation is a scheduled agent run owned by one user. agent_id is plain
// text (not a Relation), same policy as chats.agent_id, so deleting an agent
// never breaks automations — the run falls back to the base prompt.
type Automation struct {
	ID                  string `json:"id"`
	OwnerID             string `json:"ownerId,omitempty"`
	AgentID             string `json:"agentId"`
	TaskPrompt          string `json:"taskPrompt"`
	Schedule            string `json:"schedule"`
	WebhookOutURL       string `json:"webhookOutUrl,omitempty"`
	AllowWriteTools     bool   `json:"allowWriteTools"`
	Enabled             bool   `json:"enabled"`
	ChatID              string `json:"chatId,omitempty"`
	LastRun             string `json:"lastRun,omitempty"`
	NextRun             string `json:"nextRun,omitempty"`
	ConsecutiveFailures int    `json:"consecutiveFailures"`
	CreatedAt           string `json:"createdAt,omitempty"`
	UpdatedAt           string `json:"updatedAt,omitempty"`
}

// AutomationRun is one execution record of an automation.
type AutomationRun struct {
	ID              string `json:"id"`
	AutomationID    string `json:"automationId"`
	Status          string `json:"status"`
	Summary         string `json:"summary,omitempty"`
	OutputMessageID string `json:"outputMessageId,omitempty"`
	Tokens          int    `json:"tokens"`
	CreatedAt       string `json:"createdAt,omitempty"`
}

// ensureAutomationsCollection creates the automations collection: owner-only
// API rules, runtime state (last_run/next_run/consecutive_failures) as plain
// text/number columns.
func (s *Store) ensureAutomationsCollection(users *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(AutomationsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(AutomationsCollection)
	ownerOnly := "@request.auth.id != '' && owner = @request.auth.id"
	c.ListRule = new(ownerOnly)
	c.ViewRule = new(ownerOnly)
	c.CreateRule = new(ownerOnly)
	c.UpdateRule = new(ownerOnly)
	c.DeleteRule = new(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "owner", Required: true, CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "agent_id", Max: 80})
	c.Fields.Add(&core.TextField{Name: "task_prompt", Required: true, Max: 8000})
	c.Fields.Add(&core.TextField{Name: "schedule", Required: true, Max: 40})
	c.Fields.Add(&core.TextField{Name: "webhook_out_url", Max: 1000})
	c.Fields.Add(&core.BoolField{Name: "allow_write_tools"})
	c.Fields.Add(&core.BoolField{Name: "enabled"})
	c.Fields.Add(&core.TextField{Name: "chat_id", Max: 30})
	c.Fields.Add(&core.TextField{Name: "last_run", Max: 40})
	c.Fields.Add(&core.TextField{Name: "next_run", Max: 40})
	c.Fields.Add(&core.NumberField{Name: "consecutive_failures", OnlyInt: true})
	addSystemDateFields(c)
	c.AddIndex("idx_automations_owner", false, "owner", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

// ensureAutomationRunsCollection creates the automation_runs collection: one
// row per execution, cascade-deleted with its automation. Owner-scoped
// through the automation relation.
func (s *Store) ensureAutomationRunsCollection(automations *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(AutomationRunsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(AutomationRunsCollection)
	ownerOnly := "@request.auth.id != '' && automation.owner = @request.auth.id"
	c.ListRule = new(ownerOnly)
	c.ViewRule = new(ownerOnly)
	c.CreateRule = new(ownerOnly)
	c.UpdateRule = new(ownerOnly)
	c.DeleteRule = new(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "automation", Required: true, CollectionId: automations.Id, MaxSelect: 1, CascadeDelete: true})
	c.Fields.Add(&core.TextField{Name: "status", Max: 20})
	c.Fields.Add(&core.TextField{Name: "summary", Max: 500})
	c.Fields.Add(&core.TextField{Name: "output_message_id", Max: 100})
	c.Fields.Add(&core.NumberField{Name: "tokens", OnlyInt: true})
	addSystemDateFields(c)
	c.AddIndex("idx_automation_runs_automation", false, "automation", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func automationFromRecord(r *core.Record) *Automation {
	return &Automation{
		ID:                  r.Id,
		OwnerID:             r.GetString("owner"),
		AgentID:             r.GetString("agent_id"),
		TaskPrompt:          r.GetString("task_prompt"),
		Schedule:            r.GetString("schedule"),
		WebhookOutURL:       r.GetString("webhook_out_url"),
		AllowWriteTools:     r.GetBool("allow_write_tools"),
		Enabled:             r.GetBool("enabled"),
		ChatID:              r.GetString("chat_id"),
		LastRun:             r.GetString("last_run"),
		NextRun:             r.GetString("next_run"),
		ConsecutiveFailures: int(r.GetFloat("consecutive_failures")),
		CreatedAt:           r.GetString("created"),
		UpdatedAt:           r.GetString("updated"),
	}
}

// validateAutomationInput checks the caller-editable fields. Schedule must
// parse; task_prompt and webhook URL are length-capped.
func validateAutomationInput(a *Automation) error {
	if a.TaskPrompt == "" || len(a.TaskPrompt) > 8000 {
		return ErrInvalid
	}
	if _, err := ParseSchedule(a.Schedule); err != nil {
		return err
	}
	if len(a.WebhookOutURL) > 1000 {
		return ErrInvalid
	}
	return nil
}

// ListAutomations returns the owner's automations, newest first.
func (s *Store) ListAutomations(ownerID string) ([]Automation, error) {
	records, err := s.App.FindRecordsByFilter(
		AutomationsCollection,
		"owner = {:owner}",
		"-created",
		maxAutomationsPerUser, 0,
		dbx.Params{"owner": ownerID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]Automation, 0, len(records))
	for _, r := range records {
		out = append(out, *automationFromRecord(r))
	}
	return out, nil
}

// GetAutomation resolves one automation scoped to its owner.
func (s *Store) GetAutomation(id, ownerID string) (*Automation, error) {
	record, err := s.App.FindFirstRecordByFilter(
		AutomationsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": id, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return automationFromRecord(record), nil
}

// CreateAutomation inserts a new automation. Schedule must parse and Enabled
// defaults to true (flip it via UpdateAutomation). Caps at
// maxAutomationsPerUser per owner.
func (s *Store) CreateAutomation(a *Automation, ownerID string) (*Automation, error) {
	if ownerID == "" {
		return nil, ErrInvalid
	}
	if err := validateAutomationInput(a); err != nil {
		return nil, err
	}
	count, err := s.App.CountRecords(AutomationsCollection, dbx.NewExp("owner = {:o}", dbx.Params{"o": ownerID}))
	if err != nil {
		return nil, err
	}
	if count >= maxAutomationsPerUser {
		return nil, ErrLimitReached
	}

	collection, err := s.App.FindCollectionByNameOrId(AutomationsCollection)
	if err != nil {
		return nil, err
	}
	a.Enabled = true
	record := core.NewRecord(collection)
	record.Set("owner", ownerID)
	record.Set("agent_id", a.AgentID)
	record.Set("task_prompt", a.TaskPrompt)
	record.Set("schedule", a.Schedule)
	record.Set("webhook_out_url", a.WebhookOutURL)
	record.Set("allow_write_tools", a.AllowWriteTools)
	record.Set("enabled", a.Enabled)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return automationFromRecord(record), nil
}

// UpdateAutomation edits the caller-editable fields of an owner-scoped
// automation. Runtime state (chat_id, last_run, next_run,
// consecutive_failures) is left untouched.
func (s *Store) UpdateAutomation(id, ownerID string, a *Automation) (*Automation, error) {
	record, err := s.App.FindFirstRecordByFilter(
		AutomationsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": id, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := validateAutomationInput(a); err != nil {
		return nil, err
	}
	record.Set("agent_id", a.AgentID)
	record.Set("task_prompt", a.TaskPrompt)
	record.Set("schedule", a.Schedule)
	record.Set("webhook_out_url", a.WebhookOutURL)
	record.Set("allow_write_tools", a.AllowWriteTools)
	record.Set("enabled", a.Enabled)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return automationFromRecord(record), nil
}

// DeleteAutomation removes an owner-scoped automation (its runs cascade).
func (s *Store) DeleteAutomation(id, ownerID string) error {
	record, err := s.App.FindFirstRecordByFilter(
		AutomationsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": id, "owner": ownerID},
	)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

// ListDueAutomations returns enabled automations whose next_run is set and
// at or before `now` (RFC3339, parsed — robust to mixed timezones).
func (s *Store) ListDueAutomations(now time.Time) ([]Automation, error) {
	records, err := s.App.FindRecordsByFilter(
		AutomationsCollection,
		"enabled = true && next_run != ''",
		"-created",
		0, 0,
	)
	if err != nil {
		return nil, err
	}
	out := make([]Automation, 0, len(records))
	for _, r := range records {
		t, err := time.Parse(time.RFC3339, r.GetString("next_run"))
		if err != nil || t.After(now) {
			continue
		}
		out = append(out, *automationFromRecord(r))
	}
	return out, nil
}

// MarkAutomationRan records an execution outcome on the automation: sets
// last_run to now, next_run to nextRun, resets consecutive_failures on
// success, increments it on failure, and disables the automation after 3
// consecutive failures. Scheduler context: not owner-scoped.
func (s *Store) MarkAutomationRan(id string, success bool, nextRun time.Time) error {
	record, err := s.App.FindRecordById(AutomationsCollection, id)
	if err != nil {
		return ErrNotFound
	}
	failures := int(record.GetFloat("consecutive_failures"))
	if success {
		failures = 0
	} else {
		failures++
		if failures >= 3 {
			record.Set("enabled", false)
		}
	}
	record.Set("consecutive_failures", failures)
	record.Set("last_run", time.Now().UTC().Format(time.RFC3339))
	record.Set("next_run", nextRun.UTC().Format(time.RFC3339))
	return s.App.Save(record)
}

// SetAutomationChat links (or clears, with chatID "") the chat an automation
// writes into.
func (s *Store) SetAutomationChat(id, chatID string) error {
	record, err := s.App.FindRecordById(AutomationsCollection, id)
	if err != nil {
		return ErrNotFound
	}
	record.Set("chat_id", chatID)
	return s.App.Save(record)
}

func automationRunFromRecord(r *core.Record) *AutomationRun {
	return &AutomationRun{
		ID:              r.Id,
		AutomationID:    r.GetString("automation"),
		Status:          r.GetString("status"),
		Summary:         r.GetString("summary"),
		OutputMessageID: r.GetString("output_message_id"),
		Tokens:          int(r.GetFloat("tokens")),
		CreatedAt:       r.GetString("created"),
	}
}

// RecordAutomationRun appends one execution record for an automation.
func (s *Store) RecordAutomationRun(automationID, status, summary, outputMessageID string, tokens int) error {
	if status != AutomationRunStatusSuccess && status != AutomationRunStatusError {
		return ErrInvalid
	}
	collection, err := s.App.FindCollectionByNameOrId(AutomationRunsCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("automation", automationID)
	record.Set("status", status)
	record.Set("summary", summary)
	record.Set("output_message_id", outputMessageID)
	record.Set("tokens", tokens)
	return s.App.Save(record)
}

// ListAutomationRuns returns an automation's runs, newest first (default
// limit 50).
func (s *Store) ListAutomationRuns(automationID string, limit int) ([]AutomationRun, error) {
	if limit <= 0 {
		limit = 50
	}
	records, err := s.App.FindRecordsByFilter(
		AutomationRunsCollection,
		"automation = {:automation}",
		"-created",
		limit, 0,
		dbx.Params{"automation": automationID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]AutomationRun, 0, len(records))
	for _, r := range records {
		out = append(out, *automationRunFromRecord(r))
	}
	return out, nil
}
