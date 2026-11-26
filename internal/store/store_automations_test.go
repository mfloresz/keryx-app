package store

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"keryx-server/internal/config"
)

func TestAgentBundleRoundtripAndValidation(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")

	ag, err := s.CreateAgent(&Agent{
		Name:           "Bundled",
		SystemPrompt:   "sys prompt",
		Tools:          []string{"web_search", "update_artifact", "web_search"}, // dup collapses
		Skills:         []string{"writing", "editing"},
		Knowledge:      []string{"att1", "att2"},
		StarterPrompts: []string{"  Hola  ", "Dame ideas"},
	}, alice, "")
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	if !reflect.DeepEqual(ag.Tools, []string{"web_search", "update_artifact"}) {
		t.Errorf("tools after dedup = %v", ag.Tools)
	}
	if ag.StarterPrompts[0] != "Hola" {
		t.Errorf("starter prompt not trimmed: %q", ag.StarterPrompts[0])
	}

	// Roundtrip through the DB.
	got, err := s.GetAgentForStream(ag.ID, alice)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if !reflect.DeepEqual(got.Tools, []string{"web_search", "update_artifact"}) {
		t.Errorf("tools roundtrip = %v", got.Tools)
	}
	if !reflect.DeepEqual(got.Skills, []string{"writing", "editing"}) {
		t.Errorf("skills roundtrip = %v", got.Skills)
	}
	if !reflect.DeepEqual(got.Knowledge, []string{"att1", "att2"}) {
		t.Errorf("knowledge roundtrip = %v", got.Knowledge)
	}
	if !reflect.DeepEqual(got.StarterPrompts, []string{"Hola", "Dame ideas"}) {
		t.Errorf("starter prompts roundtrip = %v", got.StarterPrompts)
	}

	// Builtin catalog agents carry empty bundles.
	if len(config.DefaultAgents) > 0 {
		builtin, err := s.GetAgentForStream(config.DefaultAgents[0].ID, alice)
		if err != nil {
			t.Fatalf("get builtin agent: %v", err)
		}
		if builtin.Tools != nil || builtin.Skills != nil || builtin.Knowledge != nil || builtin.StarterPrompts != nil {
			t.Errorf("builtin bundles not empty: %+v", builtin)
		}
	}

	// Validation rules (create path).
	cases := []struct {
		name string
		mut  func(*Agent)
	}{
		{"bad tool name", func(a *Agent) { a.Tools = []string{"web_search", "bogus_tool"} }},
		{"too many tools", func(a *Agent) { a.Tools = []string{"web_search", "update_artifact", "web_searchx"} }},
		{"too many skills", func(a *Agent) {
			a.Skills = make([]string, 11)
			for i := range a.Skills {
				a.Skills[i] = "skill" + string(rune('a'+i))
			}
		}},
		{"skill name too long", func(a *Agent) { a.Skills = []string{string(make([]byte, 101))} }},
		{"too many starters", func(a *Agent) {
			a.StarterPrompts = []string{"a", "b", "c", "d", "e"}
		}},
		{"starter too long", func(a *Agent) { a.StarterPrompts = []string{string(make([]byte, 201))} }},
	}
	for _, tc := range cases {
		t.Run("create/"+tc.name, func(t *testing.T) {
			a := &Agent{Name: "V", SystemPrompt: "sys"}
			tc.mut(a)
			if _, err := s.CreateAgent(a, alice, ""); !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected ErrInvalid, got %v", err)
			}
		})
	}

	// Validation rules (update path).
	if _, err := s.UpdateAgent(ag.ID, func(a *Agent) (*Agent, error) {
		a.Tools = []string{"nope"}
		return a, nil
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("update with bad tool: expected ErrInvalid, got %v", err)
	}

	// Successful update persists bundles.
	if _, err := s.UpdateAgent(ag.ID, func(a *Agent) (*Agent, error) {
		a.Tools = []string{AgentToolWebSearch}
		return a, nil
	}); err != nil {
		t.Fatalf("update agent: %v", err)
	}
	got, _ = s.GetAgentForStream(ag.ID, alice)
	if !reflect.DeepEqual(got.Tools, []string{AgentToolWebSearch}) {
		t.Errorf("tools after update = %v", got.Tools)
	}
}

func TestAutomationsCRUDAndScoping(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	const bob = "bobtestuser0001"
	const carol = "caroltestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	s.createTestUser(t, bob, "bob@test.local")
	s.createTestUser(t, carol, "carol@test.local")

	a, err := s.CreateAutomation(&Automation{
		AgentID:    "builtin-general",
		TaskPrompt: "resume el feed",
		Schedule:   "every:1h",
	}, alice)
	if err != nil {
		t.Fatalf("create automation: %v", err)
	}
	if !a.Enabled {
		t.Error("created automation should default to enabled")
	}

	// Owner scoping: bob cannot see, mutate or delete alice's automation.
	if _, err := s.GetAutomation(a.ID, bob); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for foreign Get, got %v", err)
	}
	if _, err := s.UpdateAutomation(a.ID, bob, &Automation{TaskPrompt: "x", Schedule: "daily:09:00"}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for foreign Update, got %v", err)
	}
	if err := s.DeleteAutomation(a.ID, bob); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for foreign Delete, got %v", err)
	}

	// Update by owner (disables, changes schedule; runtime state untouched).
	up, err := s.UpdateAutomation(a.ID, alice, &Automation{
		AgentID:    "builtin-general",
		TaskPrompt: "otra tarea",
		Schedule:   "daily:09:00",
		Enabled:    false,
	})
	if err != nil {
		t.Fatalf("update automation: %v", err)
	}
	if up.Enabled || up.TaskPrompt != "otra tarea" || up.Schedule != "daily:09:00" {
		t.Errorf("unexpected update result: %+v", up)
	}

	// Invalid schedule rejected.
	if _, err := s.CreateAutomation(&Automation{TaskPrompt: "x", Schedule: "every:5m"}, alice); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid for bad schedule, got %v", err)
	}
	if _, err := s.CreateAutomation(&Automation{TaskPrompt: "", Schedule: "every:1h"}, alice); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid for empty task prompt, got %v", err)
	}

	// List is owner-scoped.
	mine, err := s.ListAutomations(alice)
	if err != nil || len(mine) != 1 {
		t.Fatalf("list automations = %v, %v; want 1", mine, err)
	}
	if theirs, err := s.ListAutomations(bob); err != nil || len(theirs) != 0 {
		t.Fatalf("foreign list = %v, %v; want empty", theirs, err)
	}

	// Cap: 20 per owner, 21st rejected.
	for i := range 20 {
		if _, err := s.CreateAutomation(&Automation{TaskPrompt: "t", Schedule: "daily:08:00"}, carol); err != nil {
			t.Fatalf("create #%d: %v", i+2, err)
		}
	}
	if _, err := s.CreateAutomation(&Automation{TaskPrompt: "t", Schedule: "daily:08:00"}, carol); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("expected ErrLimitReached on 21st, got %v", err)
	}

	// Delete by owner.
	if err := s.DeleteAutomation(a.ID, alice); err != nil {
		t.Fatalf("delete automation: %v", err)
	}
	if _, err := s.GetAutomation(a.ID, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("automation should be gone, got %v", err)
	}
}

func TestParseSchedule(t *testing.T) {
	valid := []struct {
		spec string
		want string // canonical form
	}{
		{"every:15m", "every:15m"},
		{"every:2h", "every:2h"},
		{"every:90m", "every:90m"},
		{"daily:00:00", "daily:00:00"},
		{"daily:23:59", "daily:23:59"},
	}
	for _, tc := range valid {
		sc, err := ParseSchedule(tc.spec)
		if err != nil {
			t.Errorf("ParseSchedule(%q) unexpected error: %v", tc.spec, err)
			continue
		}
		if got := sc.String(); got != tc.want {
			t.Errorf("ParseSchedule(%q).String() = %q, want %q", tc.spec, got, tc.want)
		}
	}

	invalid := []string{
		"every:5m",   // below 15m minimum
		"every:169h", // above 168h
		"every:0h",
		"every:-2h",
		"every:2d", // unsupported unit
		"every:",   // missing count
		"daily:25:00",
		"daily:12:60",
		"daily:9:30", // wrong width
		"daily:ab:cd",
		"daily",
		"garbage",
		"",
	}
	for _, spec := range invalid {
		if _, err := ParseSchedule(spec); !errors.Is(err, ErrInvalid) {
			t.Errorf("ParseSchedule(%q): expected ErrInvalid, got %v", spec, err)
		}
	}
}

func TestScheduleNext(t *testing.T) {
	utc := time.UTC

	// Interval: after + duration.
	sc, _ := ParseSchedule("every:2h")
	after := time.Date(2026, 10, 23, 8, 0, 0, 0, utc)
	if got := sc.Next(after); !got.Equal(time.Date(2026, 10, 23, 10, 0, 0, 0, utc)) {
		t.Errorf("interval Next = %v, want 10:00", got)
	}

	// Daily before the target time: same day.
	daily, _ := ParseSchedule("daily:09:30")
	if got := daily.Next(after); !got.Equal(time.Date(2026, 10, 23, 9, 30, 0, 0, utc)) {
		t.Errorf("daily Next (before target) = %v, want same day 09:30", got)
	}

	// Daily at exactly the target time: next day (strictly after).
	atTarget := time.Date(2026, 10, 23, 9, 30, 0, 0, utc)
	if got := daily.Next(atTarget); !got.Equal(time.Date(2026, 10, 24, 9, 30, 0, 0, utc)) {
		t.Errorf("daily Next (at target) = %v, want next day 09:30", got)
	}

	// Daily after the target time: next day (crosses midnight, month rollover).
	late := time.Date(2026, 10, 31, 23, 0, 0, 0, utc)
	if got := daily.Next(late); !got.Equal(time.Date(2026, 11, 1, 9, 30, 0, 0, utc)) {
		t.Errorf("daily Next (crossing midnight/month) = %v, want Nov 1 09:30", got)
	}

	// Same location as `after`.
	mad, err := time.LoadLocation("Europe/Madrid")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	got := daily.Next(time.Date(2026, 10, 23, 8, 0, 0, 0, mad))
	if got.Location() != mad || !got.Equal(time.Date(2026, 10, 23, 9, 30, 0, 0, mad)) {
		t.Errorf("daily Next location/time = %v", got)
	}
}

func TestMarkAutomationRan(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")

	a, err := s.CreateAutomation(&Automation{TaskPrompt: "t", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create automation: %v", err)
	}

	// Success resets the failure streak and sets last_run/next_run.
	next := time.Now().Add(time.Hour).UTC()
	if err := s.MarkAutomationRan(a.ID, true, next); err != nil {
		t.Fatalf("mark ran: %v", err)
	}
	got, _ := s.GetAutomation(a.ID, alice)
	if got.ConsecutiveFailures != 0 || !got.Enabled || got.LastRun == "" {
		t.Errorf("after success: %+v", got)
	}
	if got.NextRun != next.Format(time.RFC3339) {
		t.Errorf("next_run = %q, want %q", got.NextRun, next.Format(time.RFC3339))
	}

	// Two failures: still enabled, streak counts.
	for i := range 2 {
		if err := s.MarkAutomationRan(a.ID, false, next); err != nil {
			t.Fatalf("mark failed #%d: %v", i+1, err)
		}
	}
	got, _ = s.GetAutomation(a.ID, alice)
	if got.ConsecutiveFailures != 2 || !got.Enabled {
		t.Errorf("after 2 failures: %+v", got)
	}

	// Third consecutive failure disables.
	if err := s.MarkAutomationRan(a.ID, false, next); err != nil {
		t.Fatalf("mark failed #3: %v", err)
	}
	got, _ = s.GetAutomation(a.ID, alice)
	if got.ConsecutiveFailures != 3 || got.Enabled {
		t.Errorf("after 3 failures: %+v (want disabled)", got)
	}

	// Success re-enables the streak but not the flag; failure on unknown id.
	if err := s.MarkAutomationRan(a.ID, true, next); err != nil {
		t.Fatalf("mark ran after disable: %v", err)
	}
	if err := s.MarkAutomationRan("nonexistent000", true, next); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestListDueAutomations(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")

	past := time.Now().Add(-time.Hour).UTC()
	future := time.Now().Add(time.Hour).UTC()

	due, err := s.CreateAutomation(&Automation{TaskPrompt: "due", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.MarkAutomationRan(due.ID, true, past); err != nil {
		t.Fatalf("mark: %v", err)
	}

	notDue, err := s.CreateAutomation(&Automation{TaskPrompt: "future", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.MarkAutomationRan(notDue.ID, true, future); err != nil {
		t.Fatalf("mark: %v", err)
	}

	disabled, err := s.CreateAutomation(&Automation{TaskPrompt: "disabled", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.MarkAutomationRan(disabled.ID, true, past); err != nil {
		t.Fatalf("mark: %v", err)
	}
	if _, err := s.UpdateAutomation(disabled.ID, alice, &Automation{
		TaskPrompt: "disabled", Schedule: "every:1h", Enabled: false,
	}); err != nil {
		t.Fatalf("disable: %v", err)
	}

	neverRan, err := s.CreateAutomation(&Automation{TaskPrompt: "never", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_ = neverRan

	got, err := s.ListDueAutomations(time.Now())
	if err != nil {
		t.Fatalf("list due: %v", err)
	}
	if len(got) != 1 || got[0].ID != due.ID {
		t.Fatalf("due = %+v, want only %s", got, due.ID)
	}
}

func TestAutomationRunsRecordAndList(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")

	a, err := s.CreateAutomation(&Automation{TaskPrompt: "t", Schedule: "every:1h"}, alice)
	if err != nil {
		t.Fatalf("create automation: %v", err)
	}

	// Invalid status rejected.
	if err := s.RecordAutomationRun(a.ID, "meh", "s", "m1", 1); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid for bad status, got %v", err)
	}

	// Record three runs with distinct created timestamps.
	type run struct {
		status  string
		summary string
		mid     string
		tokens  int
	}
	seeded := []run{
		{AutomationRunStatusSuccess, "primera", "m1", 10},
		{AutomationRunStatusError, "segunda", "m2", 20},
		{AutomationRunStatusSuccess, "tercera", "m3", 30},
	}
	for i, r := range seeded {
		if i > 0 {
			time.Sleep(5 * time.Millisecond) // distinct created for -created order
		}
		if err := s.RecordAutomationRun(a.ID, r.status, r.summary, r.mid, r.tokens); err != nil {
			t.Fatalf("record run #%d: %v", i+1, err)
		}
	}

	runs, err := s.ListAutomationRuns(a.ID, 0)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	if len(runs) != 3 {
		t.Fatalf("runs = %d, want 3", len(runs))
	}
	// Newest first.
	last := seeded[len(seeded)-1]
	if runs[0].Status != last.status || runs[0].Summary != last.summary ||
		runs[0].OutputMessageID != last.mid || runs[0].Tokens != last.tokens {
		t.Errorf("newest run = %+v, want %+v", runs[0], last)
	}
	if runs[2].Summary != seeded[0].summary {
		t.Errorf("oldest run summary = %q, want %q", runs[2].Summary, seeded[0].summary)
	}

	// Limit returns the newest N.
	top2, err := s.ListAutomationRuns(a.ID, 2)
	if err != nil || len(top2) != 2 {
		t.Fatalf("limited runs = %v, %v", top2, err)
	}
	if top2[0].Summary != last.summary {
		t.Errorf("limited newest = %q, want %q", top2[0].Summary, last.summary)
	}

	// Cascade: deleting the automation deletes its runs.
	if err := s.DeleteAutomation(a.ID, alice); err != nil {
		t.Fatalf("delete automation: %v", err)
	}
	records, err := s.App.FindRecordsByFilter(AutomationRunsCollection, "automation = {:a}", "", 0, 0, dbx.Params{"a": a.ID})
	if err != nil {
		t.Fatalf("query runs: %v", err)
	}
	if len(records) != 0 {
		t.Errorf("runs after cascade delete = %d, want 0", len(records))
	}
}
