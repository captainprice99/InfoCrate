import React, { useState } from 'react';
import { Code, Copy, Check, FileCode, Folder, Terminal } from 'lucide-react';

interface CodeFile {
  name: string;
  path: string;
  language: string;
  category: 'core' | 'proto' | 'cmd' | 'deploy';
  content: string;
}

const CODE_FILES: CodeFile[] = [
  {
    name: 'wal.go',
    path: 'pkg/lsm/wal.go',
    language: 'go',
    category: 'core',
    content: `package lsm

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"sync"
	"time"
)

// WALEntry represents a single record in the Write-Ahead Log.
// Binary format:
// [CRC32 Checksum (4B)][Timestamp (8B)][Key Size (4B)][Value Size (4B)][Key (VarBytes)][Value (VarBytes)]
type WALEntry struct {
	CRC32       uint32
	Timestamp   int64
	Key         string
	Value       []byte
	IsTombstone bool
}

type WAL struct {
	mu       sync.Mutex
	file     *os.File
	path     string
	byteSize int64
}

func OpenWAL(path string) (*WAL, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open WAL: %w", err)
	}
	return &WAL{file: file, path: path}, nil
}

func (w *WAL) Write(key string, value []byte, isTombstone bool) (*WALEntry, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	ts := time.Now().UnixNano()
	kBytes := []byte(key)
	kSize := uint32(len(kBytes))

	var vSize uint32
	var vBytes []byte
	if !isTombstone && value != nil {
		vBytes = value
		vSize = uint32(len(value))
	}

	payloadSize := 8 + 4 + 4 + len(kBytes) + len(vBytes)
	payload := make([]byte, payloadSize)

	binary.LittleEndian.PutUint64(payload[0:8], uint64(ts))
	binary.LittleEndian.PutUint32(payload[8:12], kSize)
	binary.LittleEndian.PutUint32(payload[12:16], vSize)
	copy(payload[16:16+len(kBytes)], kBytes)
	if vSize > 0 {
		copy(payload[16+len(kBytes):], vBytes)
	}

	checksum := crc32.ChecksumIEEE(payload)

	frame := make([]byte, 4+payloadSize)
	binary.LittleEndian.PutUint32(frame[0:4], checksum)
	copy(frame[4:], payload)

	if _, err := w.file.Write(frame); err != nil {
		return nil, err
	}
	if err := w.file.Sync(); err != nil {
		return nil, err
	}

	return &WALEntry{
		CRC32:       checksum,
		Timestamp:   ts,
		Key:         key,
		Value:       value,
		IsTombstone: isTombstone,
	}, nil
}`,
  },
  {
    name: 'skiplist.go',
    path: 'pkg/lsm/skiplist.go',
    language: 'go',
    category: 'core',
    content: `package lsm

import (
	"math/rand"
	"sync"
	"time"
)

const (
	MaxSkipListLevel = 16
	Probability      = 0.5
)

type SkipListNode struct {
	Key         string
	Value       []byte
	IsTombstone bool
	Timestamp   int64
	Forward     []*SkipListNode
}

type Memtable struct {
	mu        sync.RWMutex
	head      *SkipListNode
	level     int
	sizeBytes int64
	count     int
	rnd       *rand.Rand
}

func NewMemtable() *Memtable {
	return &Memtable{
		head:  &SkipListNode{Forward: make([]*SkipListNode, MaxSkipListLevel)},
		level: 1,
		rnd:   rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

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
	if curr != nil && curr.Key == key {
		curr.Value = value
		curr.IsTombstone = false
		curr.Timestamp = ts
		return
	}

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
		Timestamp:   ts,
		Forward:     make([]*SkipListNode, lvl),
	}
	for i := 0; i < lvl; i++ {
		newNode.Forward[i] = update[i].Forward[i]
		update[i].Forward[i] = newNode
	}
	m.count++
}`,
  },
  {
    name: 'infocrate.proto',
    path: 'proto/infocrate.proto',
    language: 'protobuf',
    category: 'proto',
    content: `syntax = "proto3";
package infocrate;

option go_package = "github.com/infocrate/infocrate/pkg/proto;infocratepb";

// --- Client Facing API ---
service InfoCrate {
  rpc Put(PutRequest) returns (PutResponse);
  rpc Get(GetRequest) returns (GetResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
}

message PutRequest {
  string key = 1;
  bytes value = 2;
}
message PutResponse {
  bool success = 1;
  string leader_id = 2; // Redirects client if wrong node queried
}

message GetRequest {
  string key = 1;
}
message GetResponse {
  bool found = 1;
  bytes value = 2;
  string leader_id = 3;
}

message DeleteRequest {
  string key = 1;
}
message DeleteResponse {
  bool success = 1;
}

// --- Raft Consensus API ---
service RaftConsensus {
  rpc AppendEntries(AppendEntriesRequest) returns (AppendEntriesResponse);
  rpc RequestVote(RequestVoteRequest) returns (RequestVoteResponse);
}

message LogEntry {
  uint64 term = 1;
  uint64 index = 2;
  string command_type = 3; // "PUT" or "DELETE"
  string key = 4;
  bytes value = 5;
}

message AppendEntriesRequest {
  uint64 term = 1;
  string leader_id = 2;
  uint64 prev_log_index = 3;
  uint64 prev_log_term = 4;
  repeated LogEntry entries = 5;
  uint64 leader_commit = 6;
}

message AppendEntriesResponse {
  uint64 term = 1;
  bool success = 2;
}

message RequestVoteRequest {
  uint64 term = 1;
  string candidate_id = 2;
  uint64 last_log_index = 3;
  uint64 last_log_term = 4;
}

message RequestVoteResponse {
  uint64 term = 1;
  bool vote_granted = 2;
}`,
  },
  {
    name: 'node.go',
    path: 'pkg/raft/node.go',
    language: 'go',
    category: 'core',
    content: `package raft

import (
	"context"
	"fmt"
	"sync"
	"time"
	"github.com/infocrate/infocrate/pkg/lsm"
)

type Role string
const (
	RoleFollower  Role = "FOLLOWER"
	RoleCandidate Role = "CANDIDATE"
	RoleLeader    Role = "LEADER"
)

type Node struct {
	mu           sync.RWMutex
	role         Role
	currentTerm  uint64
	votedFor     string
	commitIndex  uint64
	lastApplied  uint64
	storage      *lsm.Engine
	peers        map[string]string
}

func (n *Node) replicateAndCommit(entry LogEntry) error {
	acks := 1 // self
	quorum := (len(n.peers) + 1)/2 + 1

	for peer := range n.peers {
		if n.sendAppendEntries(peer, entry) {
			acks++
		}
	}

	if acks >= quorum {
		n.commitIndex = entry.Index
		n.storage.Put(entry.Key, entry.Value)
		return nil
	}
	return fmt.Errorf("failed to reach quorum (%d/%d)", acks, quorum)
}`,
  },
  {
    name: 'docker-compose.yml',
    path: 'docker-compose.yml',
    language: 'yaml',
    category: 'deploy',
    content: `version: '3.8'

services:
  # Shard 0 (Raft Group 0)
  node-1:
    build: .
    command: --node-id=node-1 --shard-id=shard-0 --grpc-port=50051 --peers=node-2,node-3
    ports: ["50051:50051", "9091:9091"]
  node-2:
    build: .
    command: --node-id=node-2 --shard-id=shard-0 --grpc-port=50052 --peers=node-1,node-3
    ports: ["50052:50052", "9092:9092"]
  node-3:
    build: .
    command: --node-id=node-3 --shard-id=shard-0 --grpc-port=50053 --peers=node-1,node-2
    ports: ["50053:50053", "9093:9093"]

  # Shard 1 (Raft Group 1)
  node-4:
    build: .
    command: --node-id=node-4 --shard-id=shard-1 --grpc-port=50054 --peers=node-5,node-6
    ports: ["50054:50054", "9094:9094"]
  node-5:
    build: .
    command: --node-id=node-5 --shard-id=shard-1 --grpc-port=50055 --peers=node-4,node-6
    ports: ["50055:50055", "9095:9095"]
  node-6:
    build: .
    command: --node-id=node-6 --shard-id=shard-1 --grpc-port=50056 --peers=node-4,node-5
    ports: ["50056:50056", "9096:9096"]

  prometheus:
    image: prom/prometheus:v2.49.1
    ports: ["9090:9090"]`,
  },
];

export const CodeExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<CodeFile>(CODE_FILES[0]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#141414] font-mono flex items-center space-x-2">
            <FileCode className="w-5 h-5 text-[#141414]" />
            <span>Go 1.21+ Core Modules & Protocol Buffers</span>
          </h2>
          <p className="text-xs text-[#605F5B] mt-0.5 font-serif-italic">
            Distributed storage engine, Raft replication, Bloom filters, and compaction algorithms.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* File Navigator Sidebar */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-[#EBEAE6] border border-[#141414] p-4 shadow-sm space-y-2 font-mono text-xs">
            <div className="border-b border-[#141414] pb-2 mb-2">
              <span className="text-[#141414] uppercase tracking-wider text-[11px] font-bold block">
                Repository File Tree
              </span>
            </div>
            {CODE_FILES.map((file) => (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file)}
                className={`w-full text-left px-3 py-2 transition-all flex items-center space-x-2 border ${
                  selectedFile.path === file.path
                    ? 'bg-[#141414] text-[#FAF9F5] border-[#141414] font-bold'
                    : 'bg-[#F4F3F0] text-[#141414] hover:bg-[#EAE9E4] border-[#141414]'
                }`}
              >
                <FileCode className={`w-4 h-4 shrink-0 ${selectedFile.path === file.path ? 'text-[#FAF9F5]' : 'text-[#141414]'}`} />
                <div className="truncate flex-1">
                  <div>{file.name}</div>
                  <div className={`text-[10px] font-normal ${selectedFile.path === file.path ? 'text-[#A0A09C]' : 'text-[#605F5B]'}`}>{file.path}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Code Viewer Panel */}
        <div className="lg:col-span-8 bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-4 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-[#141414]">
            <div className="font-mono text-xs text-[#141414]">
              <span className="text-[#605F5B]">File: </span>
              <strong className="text-[#141414]">{selectedFile.path}</strong>
            </div>

            <button
              onClick={handleCopy}
              className="px-3 py-1.5 text-xs font-mono bg-[#141414] hover:bg-[#2A2927] text-[#FAF9F5] border border-[#141414] flex items-center space-x-1.5 transition-all shadow-sm"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#0F382A]" />
                  <span className="text-[#0F382A] font-bold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[#FAF9F5]" />
                  <span>Copy Code</span>
                </>
              )}
            </button>
          </div>

          <pre className="flex-1 bg-[#F4F3F0] p-4 border border-[#141414] text-xs font-mono text-[#141414] overflow-x-auto max-h-[600px] leading-relaxed">
            {selectedFile.content}
          </pre>
        </div>
      </div>
    </div>
  );
};
