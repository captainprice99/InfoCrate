package shard

import (
	"fmt"
	"hash/fnv"
	"sync"
)

// ShardInfo holds metadata for a specific Shard in the cluster.
type ShardInfo struct {
	ShardID  string
	LeaderID string
	Nodes    []string
}

// Router determines which Shard owns a given key using FNV-1a hashing.
type Router struct {
	mu          sync.RWMutex
	totalShards int
	shards      map[int]*ShardInfo
}

// NewRouter initializes a router with N total shards.
func NewRouter(totalShards int) *Router {
	if totalShards <= 0 {
		totalShards = 1
	}

	shards := make(map[int]*ShardInfo)
	for i := 0; i < totalShards; i++ {
		shards[i] = &ShardInfo{
			ShardID: fmt.Sprintf("shard-%d", i),
			Nodes:   make([]string, 0),
		}
	}

	return &Router{
		totalShards: totalShards,
		shards:      shards,
	}
}

// GetShardIDForKey computes Hash(key) % N to find the target shard index.
func (r *Router) GetShardIDForKey(key string) int {
	h := fnv.New64a()
	h.Write([]byte(key))
	return int(h.Sum64() % uint64(r.totalShards))
}

// UpdateLeader records the current leader for a shard.
func (r *Router) UpdateLeader(shardIdx int, leaderID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if s, ok := r.shards[shardIdx]; ok {
		s.LeaderID = leaderID
	}
}

// RegisterNode adds a node to a shard's replica set.
func (r *Router) RegisterNode(shardIdx int, nodeID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if s, ok := r.shards[shardIdx]; ok {
		s.Nodes = append(s.Nodes, nodeID)
	}
}

// GetShard returns information about a shard.
func (r *Router) GetShard(shardIdx int) (ShardInfo, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.shards[shardIdx]
	if !ok {
		return ShardInfo{}, false
	}
	return *s, true
}
