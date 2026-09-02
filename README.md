# InfoCrate

InfoCrate is a distributed, horizontally scalable key-value database built in Go. It guarantees strict linearizability, high availability, and crash-safe data persistence. The system utilizes gRPC for network communication, the Raft consensus algorithm for distributed state coordination, and a custom Log-Structured Merge (LSM) tree for high-throughput disk I/O.

---

## Table of Contents

1. Project Overview and Purpose
2. Architecture and System Topology
3. Technical Details
   - Storage Engine Core (LSM-Tree)
   - Write-Ahead Log (WAL) Binary Specification
   - Memtable Concurrent Skip List
   - Sorted String Tables (SSTables) and Block Indexing
   - Bloom Filters
   - Background Flushing and Compaction
   - Raft Consensus and Strict Linearizability
   - Sharding and Key Routing
4. Protocol Buffers and Interface Definitions
5. Observability and Telemetry
6. Dependencies and Requirements
7. Startup and Deployment Details
   - Local Build
   - Multi-Node Cluster via Docker Compose
   - Command-Line Client (CLI)
   - Benchmark and Chaos Verification Suite
8. File and Directory Structure

---

## 1. Project Overview and Purpose

InfoCrate is designed to solve the challenge of high-throughput distributed write workloads while maintaining strict consistency (linearizability) and durability across node failures.

Traditional relational databases often suffer from write amplification and lock contention under intense write traffic. InfoCrate pairs an append-only, log-structured merge storage engine with the Raft distributed consensus protocol.

Key Architectural Guarantees:
* Strict Linearizability: Every read and write operation observes a globally consistent sequence. Writes are acknowledged only after achieving quorum replication (N/2 + 1) in the corresponding Raft group.
* High Availability: Automatic leader election with randomized election timeouts (150ms to 300ms). The cluster tolerates up to (N-1)/2 node failures per shard without service disruption.
* Crash Safety: All writes are fsync'd to an append-only Write-Ahead Log (WAL) with CRC32 checksums before memory admission. On restart, the engine replays un-flushed WAL segments to restore the memtable.
* Read and Write Optimized Storage: Writes enter an in-memory concurrent Skip List (Memtable) in O(log N) time. Reads consult the active Memtable, Immutable Memtables, and on-disk SSTables guarded by in-memory Bloom filters and sparse index blocks to minimize disk seeks.

---

## 2. Architecture and System Topology

The cluster is partitioned into independent Shards. Each Shard is governed by a dedicated Raft consensus group containing multiple nodes (typically 3 or 5 replicas).

```
                      +-----------------------------+
                      |      Client Application     |
                      +-----------------------------+
                                     |
                                     v
                      +-----------------------------+
                      |    Router / API Gateway     |
                      |      Hash(key) % N Shards   |
                      +-----------------------------+
                                     |
                 +-------------------+-------------------+
                 |                                       |
                 v                                       v
   +---------------------------+           +---------------------------+
   |   Shard 0 (Raft Group 0)  |           |   Shard 1 (Raft Group 1)  |
   | +-----------------------+ |           | +-----------------------+ |
   | | Node 1 (Leader)       | |           | | Node 4 (Leader)       | |
   | | - Raft State Machine  | |           | | - Raft State Machine  | |
   | | - LSM Storage Engine  | |           | | - LSM Storage Engine  | |
   | +-----------------------+ |           | +-----------------------+ |
   |    | gRPC AppendEntries   |           |    | gRPC AppendEntries   |
   |    +----------+           |           |    +----------+           |
   |    |          |           |           |    |          |           |
   |    v          v           |           |    v          v           |
   | +-------+  +-------+      |           | +-------+  +-------+      |
   | | Node 2|  | Node 3|      |           | | Node 5|  | Node 6|      |
   | | Follow|  | Follow|      |           | | Follow|  | Follow|      |
   | +-------+  +-------+      |           | +-------+  +-------+      |
   +---------------------------+           +---------------------------+
```

### Component Breakdown

1. Router / API Gateway: Computes the 64-bit FNV-1a / Murmur hash of incoming keys to determine the target shard. It maintains a cached topology of current Raft leaders. If a request reaches a follower node, the follower replies with a redirect containing the current leader ID.
2. Raft Consensus Node: Maintains the replicated state machine log, handles term elections, manages leader leases, and replicates uncommitted log entries across followers using gRPC AppendEntries.
3. LSM Storage Engine: Resides on each node. Once a log entry is committed by Raft quorum, it is applied to the local LSM engine (WAL append, Skip List insertion, immutable memtable queuing, SSTable flushing, and multi-way merge compaction).

---

## 3. Technical Details

### 3.1 Storage Engine Core (LSM-Tree)

The storage engine on each node isolates write operations into sequential disk appends and in-memory skiplist updates.

Write Path:
1. Entry is received from the Raft state machine upon commit.
2. The record is serialized and appended to the Write-Ahead Log (WAL) with `fsync`.
3. The record is inserted into the active Memtable (Skip List).
4. If the active Memtable reaches its size limit (e.g., 16MB), it is marked as an Immutable Memtable, and a fresh Memtable is initialized.
5. A background goroutine flushes Immutable Memtables to Level 0 (L0) SSTables on disk.

Read Path:
1. Search active Memtable. If found (or found as a tombstone), return immediately.
2. Search Immutable Memtables from newest to oldest.
3. Search Level 0 SSTables (newest to oldest). For each SSTable, first check the in-memory Bloom filter; if negative, skip disk I/O. If positive, perform binary search on the SSTable sparse index block to locate the data block and read the key.
4. Search Level 1 and higher SSTables. Since higher levels have non-overlapping key ranges, binary search across SSTable metadata identifies the single candidate SSTable per level.

### 3.2 Write-Ahead Log (WAL) Binary Specification

The WAL is an append-only binary file ensuring crash recovery. Every committed record is encoded in the following format:

```
+------------------+------------------+------------------+--------------------+----------------+------------------+
| CRC32 (4 Bytes)  | Timestamp (8B)   | Key Size (4B)    | Value Size (4B)    | Key (VarBytes) | Value (VarBytes) |
| uint32 IEEE      | int64 Unix Nano  | uint32           | uint32 (0=Delete)  | UTF-8 String   | Binary Payload   |
+------------------+------------------+------------------+--------------------+----------------+------------------+
```

Field Specifications:
* CRC32 Checksum (4 Bytes): IEEE polynomial computed over [Timestamp + Key Size + Value Size + Key + Value]. Verifies frame integrity during crash recovery.
* Timestamp (8 Bytes): Unix timestamp in nanoseconds, providing temporal ordering.
* Key Size (4 Bytes): Little-endian uint32 denoting the byte length of the key.
* Value Size (4 Bytes): Little-endian uint32 denoting the byte length of the value. A value size of 0 with a tombstone marker denotes a deletion.
* Key (Variable Bytes): The raw key string.
* Value (Variable Bytes): The raw value payload.

Crash Recovery Mechanism:
On node startup, the engine reads the WAL file from offset 0, validates the CRC32 checksum for each frame, and inserts valid entries into the Memtable. Corrupted or partially written trailing frames are truncated at the last known valid boundary.

### 3.3 Memtable Concurrent Skip List

The Memtable is implemented as a lock-free/concurrent Skip List protected by `sync.RWMutex` to provide O(log N) search, insertion, and deletion:
* Level Generation: Geometric distribution with probability p = 0.5 up to a maximum height of 16 levels.
* Concurrency Model: Read operations acquire `RLock()`, enabling concurrent readers. Write operations acquire `Lock()`.
* Tombstones: Deletions are inserted as tombstone markers (`Value = nil`, `IsDeleted = true`) to shadow older values in SSTables.

### 3.4 Sorted String Tables (SSTables) and Block Indexing

When an Immutable Memtable is flushed, it is written as an immutable SSTable file composed of:
1. Data Blocks: Fixed-size chunks (typically 4KB) of sorted key-value entries.
2. Filter Block: Serialized Bloom filter for the entire SSTable.
3. Index Block: Array of index entries `[LastKeyInBlock, BlockOffset, BlockLength]`, enabling binary search.
4. Footer: Fixed-size 48-byte metadata trailer containing `[FilterOffset, FilterLength, IndexOffset, IndexLength, MagicNumber (0x41544C41534B56)]`.

### 3.5 Bloom Filters

Each SSTable generates an in-memory Bloom filter with m bits and k independent hash functions:
* Formula: `m = - (n * ln(p)) / (ln(2)^2)` where `n` is key count and `p` is the false-positive probability (default 1%).
* Optimal hash count: `k = (m / n) * ln(2) ~= 7`.
* Implementation uses double hashing: `g_i(x) = h1(x) + i * h2(x) mod m` using FNV-1a and Murmur3.

### 3.6 Background Compaction

A background worker periodically monitors SSTable level thresholds:
* Level 0 to Level 1: When L0 SSTable count exceeds threshold (e.g., 4 tables), L0 tables are merged with overlapping L1 tables using a k-way merge sort.
* Tombstone Garbage Collection: When an entry containing a tombstone marker is compacted into the bottom-most level (where no older versions exist), the tombstone and the shadowed key are both dropped.

### 3.7 Raft Consensus and Strict Linearizability

Each shard runs an independent Raft consensus engine following the Raft specification:

1. State Roles:
   * Follower: Accepts heartbeats and log entries from the Leader. If election timeout (150-300ms) elapses without heartbeat, transitions to Candidate.
   * Candidate: Increments term, votes for self, and sends `RequestVote` RPCs to peers. Becomes Leader upon receiving votes from a majority quorum (N/2 + 1).
   * Leader: Periodically sends empty `AppendEntries` heartbeats (every 50ms) to maintain leadership. Accepts client write requests.

2. Strict Linearizable Write Protocol:
   * Step 1: Client issues `Put(Key, Value)` to the Shard Router.
   * Step 2: Shard Router routes request to the current Shard Leader. If a Follower receives the request, it replies with `leader_id` for client redirection.
   * Step 3: Leader appends the command to its local Raft log with `Term` and `Index`.
   * Step 4: Leader broadcasts `AppendEntries` to all Followers concurrently via gRPC.
   * Step 5: Followers validate `prev_log_index` and `prev_log_term`, append entries to their Raft logs, and return success.
   * Step 6: Once the Leader receives acknowledgments from a quorum (N/2 + 1), it advances its `commit_index`.
   * Step 7: Leader applies the committed log entry to its local LSM-Tree (WAL -> Memtable).
   * Step 8: Leader returns `PutResponse{success: true}` to the client.
   * Step 9: In the subsequent heartbeat, the Leader transmits the updated `leader_commit`, prompting Followers to apply the committed entries to their local LSM-Trees.

3. Strict Linearizable Read Protocol:
   * Leader validates its lease/quorum with a heartbeat round before serving reads, ensuring no stale reads during network partitions.

---

## 4. Protocol Buffers and Interface Definitions

InfoCrate uses Protocol Buffers (proto3) to define client-facing and internal Raft RPC interfaces.

File: `proto/infocrate.proto`

```protobuf
syntax = "proto3";
package infocrate;

option go_package = "github.com/infocrate/infocrate/pkg/proto;infocratepb";

// --- Client Facing Service ---
service InfoCrate {
  rpc Put(PutRequest) returns (PutResponse);
  rpc Get(GetRequest) returns (GetResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
  rpc ClusterStatus(ClusterStatusRequest) returns (ClusterStatusResponse);
}

message PutRequest {
  string key = 1;
  bytes value = 2;
}

message PutResponse {
  bool success = 1;
  string leader_id = 2; // Redirects client if wrong node was queried
  string error_message = 3;
}

message GetRequest {
  string key = 1;
}

message GetResponse {
  bool found = 1;
  bytes value = 2;
  string leader_id = 3;
  string error_message = 4;
}

message DeleteRequest {
  string key = 1;
}

message DeleteResponse {
  bool success = 1;
  string leader_id = 2;
  string error_message = 3;
}

message ClusterStatusRequest {}

message NodeInfo {
  string node_id = 1;
  string shard_id = 2;
  string role = 3; // "LEADER", "FOLLOWER", "CANDIDATE"
  uint64 current_term = 4;
  uint64 commit_index = 5;
  string grpc_addr = 6;
  bool is_healthy = 7;
}

message ClusterStatusResponse {
  repeated NodeInfo nodes = 1;
  uint32 total_shards = 2;
}

// --- Raft Consensus Service ---
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
  uint64 match_index = 3;
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
}
```

---

### 5. Observability and Telemetry

InfoCrate embeds Prometheus metrics on port `9090` (configurable per node):

* `infocrate_writes_total`: Counter tracking total write operations.
* `infocrate_reads_total`: Counter tracking total read operations.
* `infocrate_write_latency_seconds`: Histogram of write latencies across Raft commit and LSM application.
* `infocrate_read_latency_seconds`: Histogram of read latencies.
* `infocrate_raft_current_term`: Gauge tracking the active Raft term per node.
* `infocrate_raft_commit_index`: Gauge tracking the highest committed log index.
* `infocrate_lsm_memtable_entries`: Gauge tracking active memtable entry count.
* `infocrate_lsm_sstable_count`: Gauge tracking on-disk SSTable count by level.
* `infocrate_bloom_filter_checks_total`: Counter for Bloom filter queries (hits vs misses).
* `infocrate_compaction_duration_seconds`: Histogram of background compaction runtimes.

---

## 6. Dependencies and Requirements

* Go: Version 1.21 or higher
* Protocol Buffers Compiler: `protoc` (v3.21+) and `protoc-gen-go`, `protoc-gen-go-grpc`
* Docker and Docker Compose (v2.20+) for running multi-node clusters
* Core Go Packages:
  - `google.golang.org/grpc`: High-performance gRPC transport
  - `google.golang.org/protobuf`: Protocol buffer serialization
  - `github.com/prometheus/client_golang`: Prometheus telemetry
  - `github.com/spaolacci/murmur3`: Fast non-cryptographic hashing for Bloom filters and sharding

---

## 7. Startup and Deployment Details

### 7.1 Local Build

To compile all InfoCrate binaries:

```bash
# Clone the repository
git clone https://github.com/infocrate/infocrate.git
cd infocrate

# Generate gRPC protobuf code
make proto

# Build server, CLI, and benchmark binaries
make build
```

The output binaries will be placed in `./bin/`:
* `./bin/infocrate-server`: Storage node and Raft daemon
* `./bin/infocrate-cli`: Interactive CLI client
* `./bin/infocrate-bench`: Performance benchmark and linearizability verifier

### 7.2 Running a Single Node Locally

```bash
./bin/infocrate-server \
  --node-id=node-1 \
  --shard-id=shard-0 \
  --grpc-port=50051 \
  --metrics-port=9091 \
  --data-dir=/tmp/infocrate/node-1 \
  --peers=""
```

### 7.3 Multi-Node Cluster via Docker Compose

InfoCrate provides a pre-configured 6-node cluster spanning 2 shards (3 nodes per shard) with Prometheus and Grafana.

```bash
# Start the 6-node distributed cluster
docker compose up -d

# Check cluster health
docker compose ps

# View live cluster logs
docker compose logs -f
```

Cluster Topology:
* Shard 0: `node1` (50051), `node2` (50052), `node3` (50053)
* Shard 1: `node4` (50054), `node5` (50055), `node6` (50056)
* Prometheus: `http://localhost:9090`
* Grafana: `http://localhost:3001`

### 7.4 Command-Line Client (CLI)

The interactive CLI connects to the cluster and automatically routes commands:

```bash
# Connect CLI to the cluster router
./bin/infocrate-cli --routers=localhost:50051,localhost:50054

# Interactive Commands:
infocrate> PUT user:1001 '{"name":"Alice","role":"Admin"}'
OK (Shard: 0, Leader: node-1, Latency: 1.42ms)

infocrate> GET user:1001
Found: {"name":"Alice","role":"Admin"} (Shard: 0, Leader: node-1)

infocrate> DELETE user:1001
OK (Shard: 0, Leader: node-1)

infocrate> CLUSTER-STATUS
--- Shard 0 ---
* Node 1: LEADER   (Term 3, CommitIdx: 142)
  Node 2: FOLLOWER (Term 3, CommitIdx: 142)
  Node 3: FOLLOWER (Term 3, CommitIdx: 142)

--- Shard 1 ---
* Node 4: LEADER   (Term 2, CommitIdx: 89)
  Node 5: FOLLOWER (Term 2, CommitIdx: 89)
  Node 6: FOLLOWER (Term 2, CommitIdx: 89)
```

### 7.5 Benchmark and Chaos Verification Suite

Run automated throughput benchmarks and network partition tests:

```bash
# Run 100,000 mixed operations with 32 concurrent goroutines
./bin/infocrate-bench \
  --routers=localhost:50051,localhost:50054 \
  --total-ops=100000 \
  --concurrency=32 \
  --read-ratio=0.7

# Run Linearizability and Split-Brain Verification Test
./bin/infocrate-bench --test=linearizability --duration=60s
```

---

## 8. File and Directory Structure

```
.
+-- cmd/
|   +-- server/         # Node server entry point
|   +-- cli/            # Interactive command-line client
|   +-- benchmark/      # Benchmark and chaos validation harness
+-- pkg/
|   +-- proto/          # Compiled gRPC and Protocol Buffer bindings
|   +-- lsm/            # Storage engine
|   |   +-- wal.go          # Write-Ahead Log encoder, decoder, and recovery
|   |   +-- skiplist.go     # Concurrent Skip List Memtable implementation
|   |   +-- bloom.go        # Bloom filter math and bitsets
|   |   +-- sstable.go      # SSTable block writer, sparse index, and reader
|   |   +-- compaction.go   # Leveled compaction worker and tombstone GC
|   |   +-- engine.go       # LSM-Tree manager coordinating flush & compaction
|   |   +-- raft/           # Raft consensus engine
|   |   +-- node.go         # State machine (Leader, Follower, Candidate)
|   |   +-- log.go          # Replicated log persistence
|   +-- shard/          # Sharding and key router
|   |   +-- router.go       # Hash ring and leader redirect handler
|   +-- metrics/        # Prometheus telemetry collectors
|   +-- server/         # gRPC server implementation
+-- proto/
|   +-- infocrate.proto # Protocol buffer interface definitions
+-- Dockerfile          # Multi-stage production container build
+-- docker-compose.yml  # 6-node distributed cluster setup
+-- Makefile            # Build and test orchestration targets
+-- go.mod              # Go module definition
+-- README.md           # System documentation
```
