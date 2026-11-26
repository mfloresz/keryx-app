package api

import (
	"context"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestRegisterSupersedesPreviousRun: registering a new stream for a chat
// releases the old entry's subscribers and cancels the old run's context, so
// a stale generation can't keep writing to the chat.
func TestRegisterSupersedesPreviousRun(t *testing.T) {
	r := newStreamRegistry()

	oldCtx, oldCancel := context.WithCancel(context.Background())
	old := r.register("chat_superseded", "m1", oldCancel)

	fresh := r.register("chat_superseded", "m2", func() {})

	if r.get("chat_superseded") != fresh {
		t.Fatal("expected the registry to point at the new stream")
	}
	select {
	case <-oldCtx.Done():
	default:
		t.Fatal("expected the superseded run's context to be cancelled")
	}
	select {
	case <-old.done:
	default:
		t.Fatal("expected the superseded stream to be marked done")
	}
}

// TestActiveStreamCancelIsIdempotent: Cancel is safe to call repeatedly and
// on entries built without a cancel function.
func TestActiveStreamCancelIsIdempotent(t *testing.T) {
	r := newStreamRegistry()

	ctx, cancel := context.WithCancel(context.Background())
	as := r.register("chat_cancel", "m1", cancel)

	as.Cancel()
	as.Cancel() // must not panic or deadlock

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected the context to be cancelled")
	}

	// A hand-built entry without a cancel function must not panic either.
	bare := &activeStream{done: make(chan struct{})}
	bare.Cancel()
}

// TestJanitorSweepsDoneAndExpiredEntries: the janitor removes finished
// entries older than the grace window and finishes+cancelled entries that
// never finished, while keeping just-finished entries for late reconnects.
func TestJanitorSweepsDoneAndExpiredEntries(t *testing.T) {
	r := newStreamRegistry()

	// A finished entry older than the grace window is removed.
	_, doneCancel := context.WithCancel(context.Background())
	finished := r.register("chat_done", "m1", doneCancel)
	finished.broadcastFinish("finish", nil)
	finished.mu.Lock()
	finished.finishedAt = time.Now().Add(-2 * doneStreamGrace)
	finished.mu.Unlock()

	// A still-running entry older than maxAge is finished and cancelled.
	expiredCtx, expiredCancel := context.WithCancel(context.Background())
	expired := r.register("chat_expired", "m2", expiredCancel)
	expired.mu.Lock()
	expired.startedAt = time.Now().Add(-2 * staleStreamMaxAge)
	expired.mu.Unlock()

	// A freshly finished entry survives for late reconnects.
	_, freshCancel := context.WithCancel(context.Background())
	fresh := r.register("chat_fresh", "m3", freshCancel)
	fresh.broadcastFinish("finish", nil)

	r.janitor(staleStreamMaxAge)

	if r.get("chat_done") != nil {
		t.Fatal("expected the old finished entry to be swept")
	}
	if r.get("chat_expired") != nil {
		t.Fatal("expected the expired entry to be swept")
	}
	select {
	case <-expiredCtx.Done():
	default:
		t.Fatal("expected the expired run's context to be cancelled")
	}
	if r.get("chat_fresh") == nil {
		t.Fatal("expected the just-finished entry to survive for late reconnects")
	}
}

// signalWriter closes firstWrite on the first body write, so a test can wait
// for followStream's first event without racing on the response buffer.
type signalWriter struct {
	*httptest.ResponseRecorder
	firstWrite chan struct{}
	once       sync.Once
}

func (sw *signalWriter) Write(b []byte) (int, error) {
	sw.once.Do(func() { close(sw.firstWrite) })
	return sw.ResponseRecorder.Write(b)
}

// TestFollowStreamReplaysPendingApproval: a subscriber that joins while a
// tool approval is pending sees the tool_approval event again.
func TestFollowStreamReplaysPendingApproval(t *testing.T) {
	r := newStreamRegistry()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	as := r.register("chat_replay", "m1", cancel)
	as.setPendingApproval(map[string]string{
		"approvalId": "appr_1",
		"toolCallId": "call_1",
		"name":       "write_file",
		"input":      "{}",
	})
	events, _ := as.subscribe()

	req := httptest.NewRequest("GET", "/stream", nil)
	rec := httptest.NewRecorder()
	sw := &signalWriter{ResponseRecorder: rec, firstWrite: make(chan struct{})}

	followed := make(chan struct{})
	go func() {
		defer close(followed)
		followStream(sw, sw, req, as, events)
	}()

	select {
	case <-sw.firstWrite:
	case <-time.After(2 * time.Second):
		t.Fatal("followStream never wrote the pending approval replay")
	}
	as.broadcastFinish("finish", nil)
	select {
	case <-followed:
	case <-time.After(2 * time.Second):
		t.Fatal("followStream did not return after finish")
	}

	body := rec.Body.String()
	if !strings.Contains(body, "tool_approval") {
		t.Fatalf("expected the pending approval to be replayed, got: %s", body)
	}
	if !strings.Contains(body, "finish") {
		t.Fatalf("expected a finish event, got: %s", body)
	}
}

// TestFollowStreamSkipsReplayAfterClear: once the pending approval is
// resolved, a new subscriber must not see the stale prompt.
func TestFollowStreamSkipsReplayAfterClear(t *testing.T) {
	r := newStreamRegistry()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	as := r.register("chat_cleared", "m1", cancel)
	as.setPendingApproval(map[string]string{"approvalId": "appr_1"})
	as.clearPendingApproval()
	events, _ := as.subscribe()

	req := httptest.NewRequest("GET", "/stream", nil)
	rec := httptest.NewRecorder()

	followed := make(chan struct{})
	go func() {
		defer close(followed)
		followStream(rec, rec, req, as, events)
	}()

	// Give a buggy replay time to (wrongly) appear before ending the stream.
	time.Sleep(50 * time.Millisecond)
	as.broadcastFinish("finish", nil)
	select {
	case <-followed:
	case <-time.After(2 * time.Second):
		t.Fatal("followStream did not return after finish")
	}

	if strings.Contains(rec.Body.String(), "tool_approval") {
		t.Fatalf("expected no approval replay after clear, got: %s", rec.Body.String())
	}
}

// TestEventRingReplaySinceSeq pins the sinceSeq replay contract: every
// emission path stamps a monotonically increasing seq, the ring keeps the
// most recent eventRingCap events, subscribe reports the high-water mark and
// replaySince returns exactly the events after the requested seq.
func TestEventRingReplaySinceSeq(t *testing.T) {
	r := newStreamRegistry()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	as := r.register("chat_ring", "m1", cancel)

	// Events emitted with no subscriber still accumulate in the ring.
	for i := 0; i < 10; i++ {
		as.broadcast("tool_call", map[string]string{"n": strconv.Itoa(i)})
	}
	as.append("text", "hello")

	// subscribe captures the high-water mark (10 broadcasts + 1 append).
	ch, highWater := as.subscribe()
	if highWater != 11 {
		t.Fatalf("expected high-water 11, got %d", highWater)
	}

	// Live events carry the next seq.
	as.broadcast("source", nil)
	live := <-ch
	if live.seq != highWater+1 {
		t.Fatalf("expected live event seq %d, got %d", highWater+1, live.seq)
	}

	// Replay of seq 5 returns exactly (5, 12].
	evs := as.replaySince(5)
	if len(evs) != 7 {
		t.Fatalf("expected 7 replayed events, got %d", len(evs))
	}
	if evs[0].seq != 6 || evs[len(evs)-1].seq != 12 {
		t.Fatalf("unexpected replay bounds: %d..%d", evs[0].seq, evs[len(evs)-1].seq)
	}
	// Full replay from 0.
	if all := as.replaySince(0); len(all) != 12 {
		t.Fatalf("expected 12 events from 0, got %d", len(all))
	}

	// The ring trims to the cap, dropping the oldest.
	total := 12
	for i := 0; i < eventRingCap+50; i++ {
		as.append("text", "x")
		total++
	}
	trimmed := as.replaySince(0)
	if len(trimmed) != eventRingCap {
		t.Fatalf("expected ring trimmed to %d, got %d", eventRingCap, len(trimmed))
	}
	if trimmed[0].seq != int64(total-eventRingCap+1) || trimmed[len(trimmed)-1].seq != int64(total) {
		t.Fatalf("unexpected trimmed window: %d..%d", trimmed[0].seq, trimmed[len(trimmed)-1].seq)
	}
}

// TestBroadcastFinishIsReplayable: the finish event is seq-stamped and stays
// in the ring for a sinceSeq reconnect to a just-finished stream.
func TestBroadcastFinishIsReplayable(t *testing.T) {
	r := newStreamRegistry()
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	as := r.register("chat_finish_ring", "m1", cancel)

	as.broadcast("text", map[string]string{"text": "hi"})
	as.broadcastFinish("finish", nil)

	evs := as.replaySince(0)
	if len(evs) != 2 || evs[0].event != "text" || evs[1].event != "finish" {
		t.Fatalf("unexpected ring tail: %+v", evs)
	}
	if evs[1].seq <= evs[0].seq {
		t.Fatalf("expected finish to carry a greater seq: %+v", evs)
	}
}
