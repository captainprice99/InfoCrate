package raft

import (
	"sync"
)

// LogEntry represents a replicated state machine command in Raft.
type LogEntry struct {
	Term        uint64
	Index       uint64
	CommandType string // "PUT" or "DELETE"
	Key         string
	Value       []byte
}

// ReplicatedLog manages in-memory and persistent log entries for Raft.
type ReplicatedLog struct {
	mu      sync.RWMutex
	entries []LogEntry
}

// NewReplicatedLog initializes an empty log with index 0 base.
func NewReplicatedLog() *ReplicatedLog {
	return &ReplicatedLog{
		entries: []LogEntry{
			{Term: 0, Index: 0}, // 1-based indexing base
		},
	}
}

// Append adds entries to the log.
func (l *ReplicatedLog) Append(entries ...LogEntry) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, entries...)
}

// TruncateFrom drops entries starting from index.
func (l *ReplicatedLog) TruncateFrom(index uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if index < uint64(len(l.entries)) {
		l.entries = l.entries[:index]
	}
}

// GetEntry returns the log entry at index.
func (l *ReplicatedLog) GetEntry(index uint64) (LogEntry, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if index >= uint64(len(l.entries)) {
		return LogEntry{}, false
	}
	return l.entries[index], true
}

// GetEntriesFrom returns all entries starting from index.
func (l *ReplicatedLog) GetEntriesFrom(index uint64) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if index >= uint64(len(l.entries)) {
		return nil
	}
	copied := make([]LogEntry, len(l.entries)-int(index))
	copy(copied, l.entries[index:])
	return copied
}

// LastLogInfo returns the index and term of the most recent log entry.
func (l *ReplicatedLog) LastLogInfo() (uint64, uint64) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	last := l.entries[len(l.entries)-1]
	return last.Index, last.Term
}

// LastIndex returns the last index.
func (l *ReplicatedLog) LastIndex() uint64 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return uint64(len(l.entries) - 1)
}

// EntriesSnapshot returns a copy of all current entries.
func (l *ReplicatedLog) EntriesSnapshot() []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()
	copied := make([]LogEntry, len(l.entries))
	copy(copied, l.entries)
	return copied
}
