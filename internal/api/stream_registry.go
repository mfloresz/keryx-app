package api

import (
	"sync"
	"time"
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

	// done is closed when the stream finishes (or fails), signaling any
	// reconnect listeners to stop following it.
	done chan struct{}

	// mu guards the buffers below.
	mu sync.Mutex

	// full snapshots of the accumulated text/reasoning (guarded by mu).
	fullText      string
	fullReasoning string

	// subscribers are SSE reconnect channels. Each receives every event
	// emitted after it subscribed.
	subscribersMu sync.Mutex
	subscribers   map[chan streamEvent]struct{}
}

// streamEvent is a single SSE frame forwarded to reconnecting clients.
type streamEvent struct {
	event string // "start" | "text" | "reasoning" | "finish" | "error"
	extra map[string]string
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

	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	for ch := range as.subscribers {
		select {
		case ch <- streamEvent{event: kind, extra: map[string]string{"text": text}}:
		default:
			// Slow subscriber: drop the event rather than blocking the
			// main generation goroutine. The subscriber's next poll of
			// the snapshot endpoint recovers the missing text.
		}
	}
}

func (as *activeStream) subscribe() chan streamEvent {
	ch := make(chan streamEvent, 256)
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	as.subscribers[ch] = struct{}{}
	return ch
}

func (as *activeStream) unsubscribe(ch chan streamEvent) {
	as.subscribersMu.Lock()
	defer as.subscribersMu.Unlock()
	delete(as.subscribers, ch)
}

// broadcastFinish signals all subscribers that the stream ended and closes
// the registry entry.
func (as *activeStream) broadcastFinish(event string, extra map[string]string) {
	as.subscribersMu.Lock()
	for ch := range as.subscribers {
		select {
		case ch <- streamEvent{event: event, extra: extra}:
		default:
		}
	}
	as.subscribers = nil
	as.subscribersMu.Unlock()

	select {
	case <-as.done:
	default:
		close(as.done)
	}
}

// streamRegistry keeps in-memory active streams keyed by chat ID.
type streamRegistry struct {
	mu      sync.Mutex
	streams map[string]*activeStream
}

func newStreamRegistry() *streamRegistry {
	return &streamRegistry{streams: make(map[string]*activeStream)}
}

// register adds a new active stream for chatID. If a stale entry exists
// (e.g. a previous crashed handler), it is replaced.
func (r *streamRegistry) register(chatID, assistantMessageID string) *activeStream {
	r.mu.Lock()
	defer r.mu.Unlock()
	if old, ok := r.streams[chatID]; ok {
		old.broadcastFinish("error", map[string]string{"error": "superseded"})
	}
	as := &activeStream{
		ChatID:             chatID,
		AssistantMessageID: assistantMessageID,
		startedAt:          time.Now(),
		done:               make(chan struct{}),
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
	now := time.Now()
	for id, as := range r.streams {
		select {
		case <-as.done:
			if now.Sub(as.startedAt) > 0 {
				delete(r.streams, id)
			}
		default:
			if now.Sub(as.startedAt) > maxAge {
				as.broadcastFinish("error", map[string]string{"error": "expired"})
				delete(r.streams, id)
			}
		}
	}
}
