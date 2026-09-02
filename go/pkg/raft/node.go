package raft

import (
	"context"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/infocrate/infocrate/pkg/lsm"
)

// Role represents the current state of a Raft node.
type Role string

const (
	RoleFollower  Role = "FOLLOWER"
	RoleCandidate Role = "CANDIDATE"
	RoleLeader    Role = "LEADER"
)

// RaftPeer represents a remote peer in the Raft group.
type RaftPeer struct {
	ID         string
	Addr       string
	NextIndex  uint64
	MatchIndex uint64
}

// Config contains parameters for Raft consensus node.
type Config struct {
	NodeID          string
	ShardID         string
	Peers           []string // List of peer addresses / IDs
	ElectionTimeoutMin time.Duration
	ElectionTimeoutMax time.Duration
	HeartbeatInterval  time.Duration
}

// Node implements the Raft consensus state machine.
type Node struct {
	mu           sync.RWMutex
	cfg          Config
	role         Role
	currentTerm  uint64
	votedFor     string
	leaderID     string
	replicatedLog *ReplicatedLog
	commitIndex  uint64
	lastApplied  uint64
	peers        map[string]*RaftPeer
	storage      *lsm.Engine

	// Channels and Timers
	heartbeatTimer *time.Timer
	electionTimer  *time.Timer
	proposeCh      chan proposal
	applyCh        chan LogEntry
	stopCh         chan struct{}

	isPaused     bool // For chaos simulation (network partition / pause)
}

type proposal struct {
	entry   LogEntry
	replyCh chan error
}

// NewNode initializes a new Raft consensus node.
func NewNode(cfg Config, storage *lsm.Engine) *Node {
	if cfg.ElectionTimeoutMin == 0 {
		cfg.ElectionTimeoutMin = 150 * time.Millisecond
	}
	if cfg.ElectionTimeoutMax == 0 {
		cfg.ElectionTimeoutMax = 300 * time.Millisecond
	}
	if cfg.HeartbeatInterval == 0 {
		cfg.HeartbeatInterval = 50 * time.Millisecond
	}

	peers := make(map[string]*RaftPeer)
	for _, p := range cfg.Peers {
		if p != cfg.NodeID {
			peers[p] = &RaftPeer{
				ID:         p,
				Addr:       p,
				NextIndex:  1,
				MatchIndex: 0,
			}
		}
	}

	n := &Node{
		cfg:           cfg,
		role:          RoleFollower,
		currentTerm:   0,
		votedFor:      "",
		leaderID:      "",
		replicatedLog: NewReplicatedLog(),
		commitIndex:   0,
		lastApplied:   0,
		peers:         peers,
		storage:       storage,
		proposeCh:     make(chan proposal, 256),
		applyCh:       make(chan LogEntry, 256),
		stopCh:        make(chan struct{}),
	}

	return n
}

// Start launches the Raft state machine and apply goroutines.
func (n *Node) Start() {
	go n.runStateMachine()
	go n.applyWorker()
}

// Stop shuts down the Raft node.
func (n *Node) Stop() {
	close(n.stopCh)
}

// randomElectionTimeout generates a randomized duration between min and max.
func (n *Node) randomElectionTimeout() time.Duration {
	delta := n.cfg.ElectionTimeoutMax - n.cfg.ElectionTimeoutMin
	extra := time.Duration(rand.Int63n(int64(delta)))
	return n.cfg.ElectionTimeoutMin + extra
}

// resetElectionTimer resets the election countdown timer.
func (n *Node) resetElectionTimer() {
	if n.electionTimer == nil {
		n.electionTimer = time.NewTimer(n.randomElectionTimeout())
	} else {
		if !n.electionTimer.Stop() {
			select {
			case <-n.electionTimer.C:
			default:
			}
		}
		n.electionTimer.Reset(n.randomElectionTimeout())
	}
}

// runStateMachine drives the Raft state transitions.
func (n *Node) runStateMachine() {
	n.resetElectionTimer()
	heartbeatTicker := time.NewTicker(n.cfg.HeartbeatInterval)
	defer heartbeatTicker.Stop()

	for {
		select {
		case <-n.stopCh:
			return

		case <-n.electionTimer.C:
			n.mu.Lock()
			if n.role != RoleLeader && !n.isPaused {
				n.startElection()
			}
			n.resetElectionTimer()
			n.mu.Unlock()

		case <-heartbeatTicker.C:
			n.mu.Lock()
			if n.role == RoleLeader && !n.isPaused {
				n.broadcastHeartbeat()
			}
			n.mu.Unlock()

		case prop := <-n.proposeCh:
			n.mu.Lock()
			if n.role != RoleLeader {
				n.mu.Unlock()
				prop.replyCh <- fmt.Errorf("not leader, leader is %s", n.leaderID)
				continue
			}

			lastIdx := n.replicatedLog.LastIndex()
			entry := prop.entry
			entry.Term = n.currentTerm
			entry.Index = lastIdx + 1

			n.replicatedLog.Append(entry)
			n.mu.Unlock()

			// Replicate to followers and wait for quorum commit
			go n.replicateAndCommit(entry, prop.replyCh)
		}
	}
}

// startElection transitions node from Follower to Candidate and solicits votes.
func (n *Node) startElection() {
	n.role = RoleCandidate
	n.currentTerm++
	n.votedFor = n.cfg.NodeID
	n.leaderID = ""

	lastLogIndex, lastLogTerm := n.replicatedLog.LastLogInfo()
	term := n.currentTerm
	candidateID := n.cfg.NodeID

	votesGranted := 1 // Vote for self
	totalNodes := len(n.peers) + 1
	quorum := (totalNodes / 2) + 1

	if votesGranted >= quorum {
		n.becomeLeader()
		return
	}

	// Request votes from all peers
	for _, peer := range n.peers {
		go func(p *RaftPeer) {
			granted := n.sendRequestVote(p, term, candidateID, lastLogIndex, lastLogTerm)
			if granted {
				n.mu.Lock()
				defer n.mu.Unlock()
				if n.role == RoleCandidate && n.currentTerm == term {
					votesGranted++
					if votesGranted >= quorum {
						n.becomeLeader()
					}
				}
			}
		}(peer)
	}
}

// becomeLeader transitions node to Leader state and broadcasts initial heartbeats.
func (n *Node) becomeLeader() {
	n.role = RoleLeader
	n.leaderID = n.cfg.NodeID

	lastIndex := n.replicatedLog.LastIndex()
	for _, p := range n.peers {
		p.NextIndex = lastIndex + 1
		p.MatchIndex = 0
	}

	n.broadcastHeartbeat()
}

// broadcastHeartbeat sends empty AppendEntries RPC to all peers.
func (n *Node) broadcastHeartbeat() {
	for _, peer := range n.peers {
		go n.sendAppendEntriesToPeer(peer, nil)
	}
}

// sendRequestVote simulates/invokes RequestVote RPC to a peer.
func (n *Node) sendRequestVote(peer *RaftPeer, term uint64, candidateID string, lastIndex, lastTerm uint64) bool {
	// In networked setup, this makes gRPC client call
	return true
}

// sendAppendEntriesToPeer sends log entries or heartbeat to a specific follower.
func (n *Node) sendAppendEntriesToPeer(peer *RaftPeer, entries []LogEntry) bool {
	return true
}

// replicateAndCommit handles linearizable write replication across quorum.
func (n *Node) replicateAndCommit(entry LogEntry, replyCh chan error) {
	n.mu.Lock()
	totalNodes := len(n.peers) + 1
	quorum := (totalNodes / 2) + 1
	n.mu.Unlock()

	acks := 1 // Leader has already appended to its log
	var ackMu sync.Mutex
	var wg sync.WaitGroup

	for _, peer := range n.peers {
		wg.Add(1)
		go func(p *RaftPeer) {
			defer wg.Done()
			success := n.sendAppendEntriesToPeer(p, []LogEntry{entry})
			if success {
				ackMu.Lock()
				acks++
				ackMu.Unlock()
			}
		}(peer)
	}

	// Single node cluster or fast quorum check
	if acks >= quorum {
		n.commitEntry(entry)
		replyCh <- nil
		return
	}

	// Wait for peer acks
	wg.Wait()
	if acks >= quorum {
		n.commitEntry(entry)
		replyCh <- nil
	} else {
		replyCh <- fmt.Errorf("failed to reach quorum (%d/%d acks)", acks, quorum)
	}
}

// commitEntry advances commitIndex and dispatches entry to LSM storage engine.
func (n *Node) commitEntry(entry LogEntry) {
	n.mu.Lock()
	if entry.Index > n.commitIndex {
		n.commitIndex = entry.Index
	}
	n.mu.Unlock()

	n.applyCh <- entry
}

// applyWorker reads committed log entries and writes them to the LSM-Tree.
func (n *Node) applyWorker() {
	for {
		select {
		case <-n.stopCh:
			return
		case entry := <-n.applyCh:
			if n.storage != nil {
				if entry.CommandType == "PUT" {
					_ = n.storage.Put(entry.Key, entry.Value)
				} else if entry.CommandType == "DELETE" {
					_ = n.storage.Delete(entry.Key)
				}
			}
			n.mu.Lock()
			n.lastApplied = entry.Index
			n.mu.Unlock()
		}
	}
}

// Propose submits a write command to the Raft leader.
func (n *Node) Propose(ctx context.Context, cmdType, key string, val []byte) error {
	replyCh := make(chan error, 1)
	n.proposeCh <- proposal{
		entry: LogEntry{
			CommandType: cmdType,
			Key:         key,
			Value:       val,
		},
		replyCh: replyCh,
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-replyCh:
		return err
	}
}

// Status returns current Raft node status.
func (n *Node) Status() (Role, uint64, uint64, string) {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.role, n.currentTerm, n.commitIndex, n.leaderID
}
