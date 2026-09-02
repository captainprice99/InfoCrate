package lsm

import (
	"math/rand"
	"sync"
	"time"
)

const (
	MaxSkipListLevel = 16
	Probability      = 0.5
)

// SkipListNode represents a single node across multiple levels in the Skip List.
type SkipListNode struct {
	Key         string
	Value       []byte
	IsTombstone bool
	Timestamp   int64
	Forward     []*SkipListNode
}

// Memtable is a concurrent Skip List protected by sync.RWMutex.
type Memtable struct {
	mu        sync.RWMutex
	head      *SkipListNode
	level     int
	sizeBytes int64
	count     int
	rnd       *rand.Rand
	rndMu     sync.Mutex
}

// NewMemtable initializes a new empty Skip List memtable.
func NewMemtable() *Memtable {
	source := rand.NewSource(time.Now().UnixNano())
	head := &SkipListNode{
		Key:     "",
		Forward: make([]*SkipListNode, MaxSkipListLevel),
	}
	return &Memtable{
		head:  head,
		level: 1,
		rnd:   rand.New(source),
	}
}

// randomLevel generates a random height for a new node following a geometric distribution.
func (m *Memtable) randomLevel() int {
	m.rndMu.Lock()
	defer m.rndMu.Unlock()

	lvl := 1
	for lvl < MaxSkipListLevel && m.rnd.Float64() < Probability {
		lvl++
	}
	return lvl
}

// Put inserts or updates a key-value entry in the Skip List.
func (m *Memtable) Put(key string, value []byte, ts int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	update := make([]*SkipListNode, MaxSkipListLevel)
	curr := m.head

	for i := m.level - 1; i >= 0; i-- {
		for curr.Forward[i] != nil && curr.Forward[i].Key < key {
			curr = curr.Forward[i]
		}
		update[i] = curr
	}

	curr = curr.Forward[0]

	// Key already exists: update in place
	if curr != nil && curr.Key == key {
		oldSize := int64(len(curr.Key) + len(curr.Value))
		newSize := int64(len(key) + len(value))
		m.sizeBytes += (newSize - oldSize)

		curr.Value = value
		curr.IsTombstone = false
		curr.Timestamp = ts
		return
	}

	// Key does not exist: insert new node
	lvl := m.randomLevel()
	if lvl > m.level {
		for i := m.level; i < lvl; i++ {
			update[i] = m.head
		}
		m.level = lvl
	}

	newNode := &SkipListNode{
		Key:         key,
		Value:       value,
		IsTombstone: false,
		Timestamp:   ts,
		Forward:     make([]*SkipListNode, lvl),
	}

	for i := 0; i < lvl; i++ {
		newNode.Forward[i] = update[i].Forward[i]
		update[i].Forward[i] = newNode
	}

	m.count++
	m.sizeBytes += int64(len(key) + len(value) + (lvl * 8) + 32)
}

// Delete marks a key with a tombstone in the Skip List.
func (m *Memtable) Delete(key string, ts int64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	update := make([]*SkipListNode, MaxSkipListLevel)
	curr := m.head

	for i := m.level - 1; i >= 0; i-- {
		for curr.Forward[i] != nil && curr.Forward[i].Key < key {
			curr = curr.Forward[i]
		}
		update[i] = curr
	}

	curr = curr.Forward[0]

	if curr != nil && curr.Key == key {
		oldSize := int64(len(curr.Value))
		m.sizeBytes -= oldSize
		curr.Value = nil
		curr.IsTombstone = true
		curr.Timestamp = ts
		return
	}

	// Insert tombstone node if key wasn't in memory
	lvl := m.randomLevel()
	if lvl > m.level {
		for i := m.level; i < lvl; i++ {
			update[i] = m.head
		}
		m.level = lvl
	}

	newNode := &SkipListNode{
		Key:         key,
		Value:       nil,
		IsTombstone: true,
		Timestamp:   ts,
		Forward:     make([]*SkipListNode, lvl),
	}

	for i := 0; i < lvl; i++ {
		newNode.Forward[i] = update[i].Forward[i]
		update[i].Forward[i] = newNode
	}

	m.count++
	m.sizeBytes += int64(len(key) + (lvl * 8) + 32)
}

// Get searches for a key in the Skip List with concurrent read lock.
// Returns (value, isTombstone, found).
func (m *Memtable) Get(key string) ([]byte, bool, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	curr := m.head
	for i := m.level - 1; i >= 0; i-- {
		for curr.Forward[i] != nil && curr.Forward[i].Key < key {
			curr = curr.Forward[i]
		}
	}

	curr = curr.Forward[0]
	if curr != nil && curr.Key == key {
		if curr.IsTombstone {
			return nil, true, true
		}
		return curr.Value, false, true
	}

	return nil, false, false
}

// Entry represents an ordered key-value record for iteration and flushing.
type Entry struct {
	Key         string
	Value       []byte
	IsTombstone bool
	Timestamp   int64
}

// AllEntries returns all entries in sorted order.
func (m *Memtable) AllEntries() []Entry {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entries := make([]Entry, 0, m.count)
	curr := m.head.Forward[0]
	for curr != nil {
		entries = append(entries, Entry{
			Key:         curr.Key,
			Value:       curr.Value,
			IsTombstone: curr.IsTombstone,
			Timestamp:   curr.Timestamp,
		})
		curr = curr.Forward[0]
	}
	return entries
}

// Size returns the approximate memory footprint in bytes.
func (m *Memtable) Size() int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sizeBytes
}

// Count returns the number of active items in the memtable.
func (m *Memtable) Count() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.count
}
