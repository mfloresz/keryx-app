package store

// AgentRecordView is a minimal projection of an agent DB record used by
// handlers for authorization checks without importing PocketBase types.
type AgentRecordView struct {
	ID        string
	OwnerID   string
	BuiltinID string
}
