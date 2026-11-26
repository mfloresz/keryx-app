package api

import (
	"context"
	"sync"
	"time"
)

const (
	// staleStreamMaxAge bounds how long a run may stay registered without
	// finishing. Comfortably above the 10-minute generation budget.
	staleStreamMaxAge = 15 * time.Minute
	// doneStreamGrace keeps finished entries briefly after completion so a
	// client reconnecting right after a stream ends still gets a clean
	// finish/replay instead of racing a removed entry.
	doneStreamGrace = 2 * time.Minute
	// eventRingCap bounds how many recent seq-stamped events each active
	// stream keeps for ?sinceSeq replay (drop oldest).
	eventRingCap = 2048
)

// activeStream tracks an in-progress chat completion so other clients
// (or the same client after a navigation or page reload) can reconnect
// and keep receiving the response.
type activeStream struct {
	ChatID             string
	AssistantMessageID string

	// startedAt is used for janitor cleanup of streams whose handler died
	// without unregistering (should not happen, but defensive).
	startedAt time.Time
	// finishedAt is recorded when done is closed, so the janitor can keep
	// just-finished entries around for doneStreamGrace.
	finishedAt time.Time

	// done is closed when the stream finishes (or fails), signaling any
	// reconnect listeners to stop following it.
	done chan struct{}

	// cancelMu guards cancel, which stops the run goroutine's context. It is
	// separate from mu so cancelling never blocks on stream buffers.
	cancelMu sync.Mutex
	cancel   context.CancelFunc

	// mu guards the buffers below.
	mu sync.Mutex

	// full snapshots of the accumulated text/reasoning (guarded by mu).
	fullText      string
	fullReasoning string

	// pendingApproval holds the tool_approval event currently waiting for
	// the user's answer, so a client that subscribes mid-wait sees the
	// prompt again (see followStream). Nil when nothing is pending.
	pendingApproval map[string]string

	// subscribers are SSE reconnect channels. Each receives every event
	// emitted after it subscribed.
	subscribersMu sync.Mutex
	subscribers   map[chan streamEvent]struct{}

	// seq is the monotonically increasing event counter and events the ring
	// of the most recent events, kept so a reconnecting client can replay
	// everything it missed with ?sinceSeq=N. Both guarded by subscribersMu so
	// subscribe captures a consistent high-water mark.
	seq    int64
	events []streamEvent
}

// streamEvent is a single SSE frame forwarded to reconnecting clients. seq is
// the event's position in the stream's event log; 0 marks prologue events
// written by the reconnect handler itself (never replayed, no id line).
type streamEvent struct {
	event string // "start" | "text" | "reasoning" | "tool_call" | "tool_result" | "tool_approval" | "source" | "artifact" | "finish" | "error"
	extra map[string]string
	seq   int64
}

func (as *activeStream) snapshot() (text, reasoning string) {
	as.mu.Lock()
	defer as.mu.Unlock()
	return as.fullText, as.fullReasoning
}

func (as *activeStream) append(kind, text string) {
	as.mu.Lock()
	if kind == "reasoning" {
		as.fullReasoning += text
	} else {
		as.fullText += text
	}
	as.mu.Unlock()

	as.emit(kind, map[string]string{"text": text})
}

// emit stamps the event with the next seq, appends it to the replay ring and
// delivers it to every subscriber. The whole operation runs under
// subscribersMu so subscribe() always captures a consistent high-water mark.
func (as *activeStream) emit(event string, extra map[string]string) {
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	as.seq++
	ev := streamEvent{event: event, extra: extra, seq: as.seq}
	as.events = append(as.events, ev)
	if len(as.events) > eventRingCap {
		as.events = append([]streamEvent(nil), as.events[len(as.events)-eventRingCap:]...)
	}
	for ch := range as.subscribers {
		select {
		case ch <- ev:
		default:
			// Slow subscriber: drop the event rather than blocking the
			// main generation goroutine. The subscriber's next poll of
			// the snapshot endpoint recovers the missing text.
		}
	}
}

// broadcast forwards a pre-formatted event to reconnect subscribers without
// touching the accumulated text/reasoning snapshots (used for tool activity,
// which is persisted with the assistant message instead).
func (as *activeStream) broadcast(event string, extra map[string]string) {
	as.emit(event, extra)
}

// subscribe registers a new subscriber channel and returns it together with
// the current high-water seq: every event emitted from now on carries a
// greater seq and lands in the channel.
func (as *activeStream) subscribe() (chan streamEvent, int64) {
	ch := make(chan streamEvent, 256)
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	as.subscribers[ch] = struct{}{}
	return ch, as.seq
}

// replaySince returns the ring events with a seq greater than since, read
// under subscribersMu for a consistent view.
func (as *activeStream) replaySince(since int64) []streamEvent {
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	var out []streamEvent
	for _, ev := range as.events {
		if ev.seq > since {
			out = append(out, ev)
		}
	}
	return out
}

func (as *activeStream) unsubscribe(ch chan streamEvent) {
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	delete(as.subscribers, ch)
}

// isDone reports whether the stream already finished.
func (as *activeStream) isDone() bool {
	select {
	case <-as.done:
		return true
	default:
		return false
	}
}

// Cancel stops the run goroutine's context. Idempotent and safe on entries
// built without a cancel function.
func (as *activeStream) Cancel() {
	as.cancelMu.Lock()
	defer as.cancelMu.Unlock()
	if as.cancel != nil {
		as.cancel()
	}
}

// setPendingApproval records the tool_approval event waiting for the user's
// answer. The map is treated as immutable after construction.
func (as *activeStream) setPendingApproval(extra map[string]string) {
	as.mu.Lock()
	defer as.mu.Unlock()
	as.pendingApproval = extra
}

// clearPendingApproval drops the recorded pending approval (decision arrived,
// run cancelled, stream ended, or approval timed out).
func (as *activeStream) clearPendingApproval() {
	as.mu.Lock()
	defer as.mu.Unlock()
	as.pendingApproval = nil
}

// pendingApprovalEvent returns the recorded pending approval, if any.
func (as *activeStream) pendingApprovalEvent() (map[string]string, bool) {
	as.mu.Lock()
	defer as.mu.Unlock()
	if as.pendingApproval == nil {
		return nil, false
	}
	return as.pendingApproval, true
}

// broadcastFinish signals all subscribers that the stream ended and closes
// the registry entry. The finish event is seq-stamped and ring-recorded like
// every other emission, so a sinceSeq reconnect to a just-finished stream
// still sees a terminal event before the entry is swept.
func (as *activeStream) broadcastFinish(event string, extra map[string]string) {
	as.mu.Lock()
	as.pendingApproval = nil
	select {
	case <-as.done:
		// Already finished; keep the original finishedAt.
	default:
		as.finishedAt = time.Now()
		close(as.done)
	}
	as.mu.Unlock()

	as.subscribersMu.Lock()
	as.seq++
	ev := streamEvent{event: event, extra: extra, seq: as.seq}
	as.events = append(as.events, ev)
	if len(as.events) > eventRingCap {
		as.events = append([]streamEvent(nil), as.events[len(as.events)-eventRingCap:]...)
	}
	for ch := range as.subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
	as.subscribers = nil
	as.subscribersMu.Unlock()
}

// streamRegistry keeps in-memory active streams keyed by chat ID.
type streamRegistry struct {
	mu      sync.Mutex
	streams map[string]*activeStream
}

func newStreamRegistry() *streamRegistry {
	return &streamRegistry{streams: make(map[string]*activeStream)}
}

// register adds a new active stream for chatID. If a previous run exists for
// the chat it is superseded: its subscribers are released and its generation
// context is cancelled. Stale entries are swept opportunistically so the map
// never grows without bound.
func (r *streamRegistry) register(chatID, assistantMessageID string, cancel context.CancelFunc) *activeStream {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.janitorLocked(time.Now(), staleStreamMaxAge)
	if old, ok := r.streams[chatID]; ok {
		old.broadcastFinish("error", map[string]string{"error": "superseded"})
		// Stop the superseded generation: its goroutine is still running on
		// a context the new run does not own.
		old.Cancel()
	}
	as := &activeStream{
		ChatID:             chatID,
		AssistantMessageID: assistantMessageID,
		startedAt:          time.Now(),
		done:               make(chan struct{}),
		cancel:             cancel,
		subscribers:        make(map[chan streamEvent]struct{}),
	}
	r.streams[chatID] = as
	return as
}

// get returns the active stream for a chat, or nil.
func (r *streamRegistry) get(chatID string) *activeStream {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.streams[chatID]
}

// remove deletes the registry entry if it still points at as.
func (r *streamRegistry) remove(chatID string, as *activeStream) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if cur, ok := r.streams[chatID]; ok && cur == as {
		delete(r.streams, chatID)
	}
}

// janitor removes registry entries older than maxAge whose done channel is
// closed but were never removed (defensive leak guard).
func (r *streamRegistry) janitor(maxAge time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.janitorLocked(time.Now(), maxAge)
}

// janitorLocked is the lock-free janitor body; the caller must hold r.mu.
// Done entries are only swept once they are older than doneStreamGrace, so
// a late reconnect after a just-finished stream still gets a clean finish
// instead of a removed entry. Expired (never finished) runs are finished,
// cancelled and removed.
func (r *streamRegistry) janitorLocked(now time.Time, maxAge time.Duration) {
	for id, as := range r.streams {
		select {
		case <-as.done:
			if !as.finishedAt.IsZero() && now.Sub(as.finishedAt) > doneStreamGrace {
				delete(r.streams, id)
			}
		default:
			if now.Sub(as.startedAt) > maxAge {
				as.broadcastFinish("error", map[string]string{"error": "expired"})
				as.Cancel()
				delete(r.streams, id)
			}
		}
	}
}
