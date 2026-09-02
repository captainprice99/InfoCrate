import { ShardState, NodeState, RaftLogEntry, QueryResult, ExecutionStep, ClusterMetrics } from '../types/infocrate';
import { SimulatedLsmEngine } from './storageEngine';
import { fnv1a64 } from './crc32';

export class ClusterSimulator {
  private shards: ShardState[] = [];
  private lsmEngines: Map<string, SimulatedLsmEngine> = new Map();
  private metrics: ClusterMetrics = {
    totalWrites: 0,
    totalReads: 0,
    totalDeletes: 0,
    avgLatencyMs: 1.45,
    p99LatencyMs: 3.2,
    qps: 0,
    bloomHits: 142,
    bloomChecks: 380,
    compactions: 4,
    historyQPS: [],
  };
  private listeners: (() => void)[] = [];
  private heartbeatInterval: any = null;
  private queryHistory: QueryResult[] = [];

  constructor() {
    this.initCluster();
    this.startHeartbeatLoop();
  }

  private initCluster() {
    // 2 Shards, 3 Nodes each
    const initialKeysShard0: Record<string, string> = {
      'user:1001': '{"name":"Alice","role":"Admin","tier":"Enterprise"}',
      'user:1003': '{"name":"Charlie","role":"Engineer","tier":"Pro"}',
      'org:alpha': '{"plan":"Standard","seats":50}',
    };

    const initialKeysShard1: Record<string, string> = {
      'user:1002': '{"name":"Bob","role":"Architect","tier":"Enterprise"}',
      'user:1004': '{"name":"Diana","role":"Security","tier":"Enterprise"}',
      'org:beta': '{"plan":"Enterprise","seats":500}',
    };

    const shard0Nodes: NodeState[] = [
      this.createNode('node-1', 'shard-0', 'LEADER', 3, 50051, 9091, initialKeysShard0),
      this.createNode('node-2', 'shard-0', 'FOLLOWER', 3, 50052, 9092, initialKeysShard0),
      this.createNode('node-3', 'shard-0', 'FOLLOWER', 3, 50053, 9093, initialKeysShard0),
    ];

    const shard1Nodes: NodeState[] = [
      this.createNode('node-4', 'shard-1', 'LEADER', 2, 50054, 9094, initialKeysShard1),
      this.createNode('node-5', 'shard-1', 'FOLLOWER', 2, 50055, 9095, initialKeysShard1),
      this.createNode('node-6', 'shard-1', 'FOLLOWER', 2, 50056, 9096, initialKeysShard1),
    ];

    this.shards = [
      { id: 'shard-0', shardIndex: 0, leaderId: 'node-1', nodes: shard0Nodes },
      { id: 'shard-1', shardIndex: 1, leaderId: 'node-4', nodes: shard1Nodes },
    ];
  }

  private createNode(
    id: string,
    shardId: string,
    role: 'LEADER' | 'FOLLOWER' | 'CANDIDATE',
    term: number,
    grpcPort: number,
    metricsPort: number,
    initialData?: Record<string, string>
  ): NodeState {
    const lsm = new SimulatedLsmEngine(initialData);
    this.lsmEngines.set(id, lsm);

    const log: RaftLogEntry[] = [
      { term: 1, index: 1, commandType: 'PUT', key: 'cluster:init', value: 'OK', timestamp: Date.now() - 50000 },
      { term: term, index: 2, commandType: 'PUT', key: 'sys:epoch', value: '1', timestamp: Date.now() - 20000 },
    ];

    return {
      id,
      shardId,
      role,
      currentTerm: term,
      votedFor: role === 'LEADER' ? id : (role === 'CANDIDATE' ? id : null),
      commitIndex: 2,
      lastApplied: 2,
      grpcPort,
      metricsPort,
      isHealthy: true,
      isPartitioned: false,
      electionTimeoutMs: 150 + Math.floor(Math.random() * 150),
      timeSinceLastHeartbeat: 0,
      log,
      walFrames: lsm.getWalFrames(),
      memtable: lsm.getMemtableSnapshot(),
      immutableMemtables: [],
      sstablesL0: lsm.getL0Tables(),
      sstablesL1: lsm.getL1Tables(),
      bloomChecks: 24,
      bloomHits: 18,
      compactionCount: 1,
    };
  }

  private startHeartbeatLoop() {
    this.heartbeatInterval = setInterval(() => {
      for (const shard of this.shards) {
        const healthyNodes = shard.nodes.filter((n) => n.isHealthy && !n.isPartitioned);
        const leader = shard.nodes.find((n) => n.id === shard.leaderId && n.isHealthy && !n.isPartitioned);

        if (!leader && healthyNodes.length >= 2) {
          // Trigger automatic election in majority partition
          const candidate = healthyNodes[0];
          candidate.role = 'CANDIDATE';
          candidate.currentTerm++;
          candidate.votedFor = candidate.id;

          // Majority vote
          candidate.role = 'LEADER';
          shard.leaderId = candidate.id;
          for (const follower of healthyNodes) {
            if (follower.id !== candidate.id) {
              follower.role = 'FOLLOWER';
              follower.currentTerm = candidate.currentTerm;
            }
          }
        }
      }

      this.syncState();
      this.notify();
    }, 1000);
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  public getShardForKey(key: string): number {
    const hash = fnv1a64(key);
    return Number(hash % BigInt(this.shards.length));
  }

  public executeQuery(command: 'PUT' | 'GET' | 'DELETE', key: string, value: string | null): QueryResult {
    const startTime = performance.now();
    const shardIdx = this.getShardForKey(key);
    const shard = this.shards[shardIdx];
    const steps: ExecutionStep[] = [];
    const queryId = 'q_' + Math.random().toString(36).substring(2, 9);

    // Step 1: Shard Routing
    steps.push({
      stepNumber: 1,
      title: 'Router Hash Calculation',
      description: `Computed FNV-1a Hash("${key}") % ${this.shards.length} = Shard ${shardIdx}`,
      shardId: shard.id,
      status: 'success',
      timestamp: Date.now(),
    });

    const leader = shard.nodes.find((n) => n.id === shard.leaderId && n.isHealthy && !n.isPartitioned);

    if (!leader) {
      steps.push({
        stepNumber: 2,
        title: 'Leader Unavailable (No Quorum)',
        description: `Shard ${shardIdx} has no active leader or majority partition is lost.`,
        shardId: shard.id,
        status: 'error',
        timestamp: Date.now(),
      });

      const res: QueryResult = {
        id: queryId,
        command,
        key,
        value,
        shardIndex: shardIdx,
        targetNodeId: shard.leaderId || 'none',
        leaderId: shard.leaderId || 'none',
        success: false,
        latencyMs: Number((performance.now() - startTime).toFixed(2)),
        timestamp: Date.now(),
        steps,
        error: 'ClusterUnavailable: No leader found in quorum partition',
      };
      this.queryHistory.unshift(res);
      this.notify();
      return res;
    }

    // Step 2: gRPC Dispatch
    steps.push({
      stepNumber: 2,
      title: `gRPC Client Request -> ${leader.id}`,
      description: `Dispatched ${command} RPC to current Leader ${leader.id} (Port: ${leader.grpcPort})`,
      nodeId: leader.id,
      shardId: shard.id,
      status: 'success',
      timestamp: Date.now(),
    });

    if (command === 'GET') {
      const lsm = this.lsmEngines.get(leader.id)!;
      const getRes = lsm.get(key);

      steps.push({
        stepNumber: 3,
        title: 'LSM-Tree Hierarchy Lookup',
        description: `Consulted Memtable -> Bloom Filter -> SSTables. Result: ${getRes.location}`,
        nodeId: leader.id,
        shardId: shard.id,
        status: getRes.found ? 'success' : 'warning',
        timestamp: Date.now(),
        details: { location: getRes.location, bloomChecked: getRes.bloomChecked },
      });

      this.metrics.totalReads++;
      this.metrics.bloomChecks += getRes.bloomChecked ? 1 : 0;
      if (getRes.found) this.metrics.bloomHits++;

      const res: QueryResult = {
        id: queryId,
        command: 'GET',
        key,
        value: getRes.value,
        shardIndex: shardIdx,
        targetNodeId: leader.id,
        leaderId: leader.id,
        success: true,
        found: getRes.found,
        latencyMs: Number((performance.now() - startTime).toFixed(2)),
        timestamp: Date.now(),
        steps,
      };
      this.queryHistory.unshift(res);
      this.notify();
      return res;
    }

    // Write Path: PUT or DELETE
    const nextIndex = leader.log.length + 1;
    const newEntry: RaftLogEntry = {
      term: leader.currentTerm,
      index: nextIndex,
      commandType: command,
      key,
      value,
      timestamp: Date.now(),
    };

    // Step 3: Local Raft Log Append
    steps.push({
      stepNumber: 3,
      title: 'Leader Log Append (Uncommitted)',
      description: `Appended [Term ${newEntry.term}, Index ${newEntry.index}] command ${command}("${key}") to local Raft log`,
      nodeId: leader.id,
      shardId: shard.id,
      status: 'success',
      timestamp: Date.now(),
    });
    leader.log.push(newEntry);

    // Step 4: Replicate AppendEntries to Followers
    const peerFollowers = shard.nodes.filter((n) => n.id !== leader.id && n.isHealthy && !n.isPartitioned);
    let acks = 1; // leader acks itself

    for (const follower of peerFollowers) {
      follower.log.push({ ...newEntry });
      acks++;
    }

    const quorum = Math.floor(shard.nodes.length / 2) + 1;
    const quorumAchieved = acks >= quorum;

    steps.push({
      stepNumber: 4,
      title: `Raft Quorum Replication (${acks}/${shard.nodes.length} ACKs)`,
      description: quorumAchieved
        ? `Quorum achieved (${acks}/${shard.nodes.length} nodes). Advancing commitIndex to ${nextIndex}`
        : `Quorum failed (${acks}/${shard.nodes.length} nodes). Entry rejected.`,
      nodeId: leader.id,
      shardId: shard.id,
      status: quorumAchieved ? 'success' : 'error',
      timestamp: Date.now(),
    });

    if (!quorumAchieved) {
      const res: QueryResult = {
        id: queryId,
        command,
        key,
        value,
        shardIndex: shardIdx,
        targetNodeId: leader.id,
        leaderId: leader.id,
        success: false,
        latencyMs: Number((performance.now() - startTime).toFixed(2)),
        timestamp: Date.now(),
        steps,
        error: 'RaftQuorumFailure: Partition prevent majority agreement',
      };
      this.queryHistory.unshift(res);
      this.notify();
      return res;
    }

    // Step 5: Advance Commit Index & Apply to LSM
    leader.commitIndex = nextIndex;
    for (const node of shard.nodes) {
      if (node.isHealthy && !node.isPartitioned) {
        node.commitIndex = nextIndex;
        node.lastApplied = nextIndex;
        const lsm = this.lsmEngines.get(node.id)!;
        if (command === 'PUT' && value) {
          lsm.put(key, value);
        } else if (command === 'DELETE') {
          lsm.delete(key);
        }
      }
    }

    steps.push({
      stepNumber: 5,
      title: 'LSM Engine Apply: WAL fsync -> Skip List Memtable',
      description: `Binary WAL frame encoded with CRC32 IEEE & appended. Record inserted into Concurrent Skip List.`,
      nodeId: leader.id,
      shardId: shard.id,
      status: 'success',
      timestamp: Date.now(),
    });

    if (command === 'PUT') this.metrics.totalWrites++;
    if (command === 'DELETE') this.metrics.totalDeletes++;

    this.syncState();

    const latency = Number((performance.now() - startTime).toFixed(2));
    const res: QueryResult = {
      id: queryId,
      command,
      key,
      value,
      shardIndex: shardIdx,
      targetNodeId: leader.id,
      leaderId: leader.id,
      success: true,
      latencyMs: latency,
      timestamp: Date.now(),
      steps,
    };

    this.queryHistory.unshift(res);
    if (this.queryHistory.length > 50) this.queryHistory.pop();
    this.notify();
    return res;
  }

  public toggleNodeHealth(nodeId: string) {
    for (const shard of this.shards) {
      const node = shard.nodes.find((n) => n.id === nodeId);
      if (node) {
        node.isHealthy = !node.isHealthy;
        if (!node.isHealthy && shard.leaderId === nodeId) {
          shard.leaderId = null;
        }
        break;
      }
    }
    this.syncState();
    this.notify();
  }

  public toggleNodePartition(nodeId: string) {
    for (const shard of this.shards) {
      const node = shard.nodes.find((n) => n.id === nodeId);
      if (node) {
        node.isPartitioned = !node.isPartitioned;
        if (node.isPartitioned && shard.leaderId === nodeId) {
          shard.leaderId = null;
        }
        break;
      }
    }
    this.syncState();
    this.notify();
  }

  public triggerCompaction(nodeId: string) {
    const lsm = this.lsmEngines.get(nodeId);
    if (lsm) {
      lsm.triggerCompaction();
      this.metrics.compactions++;
      this.syncState();
      this.notify();
    }
  }

  public flushMemtable(nodeId: string) {
    const lsm = this.lsmEngines.get(nodeId);
    if (lsm) {
      lsm.rotateAndFlush();
      this.syncState();
      this.notify();
    }
  }

  private syncState() {
    for (const shard of this.shards) {
      for (const node of shard.nodes) {
        const lsm = this.lsmEngines.get(node.id);
        if (lsm) {
          node.walFrames = lsm.getWalFrames();
          node.memtable = lsm.getMemtableSnapshot();
          node.sstablesL0 = lsm.getL0Tables();
          node.sstablesL1 = lsm.getL1Tables();
        }
      }
    }
  }

  public getShards(): ShardState[] {
    return this.shards;
  }

  public getMetrics(): ClusterMetrics {
    return this.metrics;
  }

  public getQueryHistory(): QueryResult[] {
    return this.queryHistory;
  }
}

export const clusterInstance = new ClusterSimulator();
