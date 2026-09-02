export type RaftRole = 'LEADER' | 'FOLLOWER' | 'CANDIDATE';

export interface RaftLogEntry {
  term: number;
  index: number;
  commandType: 'PUT' | 'DELETE';
  key: string;
  value: string | null;
  timestamp: number;
}

export interface WalFrame {
  offset: number;
  crc32: string;
  crcValid: boolean;
  timestamp: number;
  keySize: number;
  valSize: number;
  key: string;
  value: string | null;
  isTombstone: boolean;
  rawHex: string;
}

export interface SkipListNodeView {
  key: string;
  value: string | null;
  isTombstone: boolean;
  timestamp: number;
  height: number;
}

export interface SSTableBlockView {
  blockIndex: number;
  offset: number;
  length: number;
  lastKey: string;
  entries: {
    key: string;
    value: string | null;
    isTombstone: boolean;
    timestamp: number;
  }[];
}

export interface SSTableView {
  id: number;
  level: number;
  minKey: string;
  maxKey: string;
  entryCount: number;
  fileBytes: number;
  filename: string;
  bloomBitArray: boolean[];
  bloomNumBits: number;
  bloomNumHash: number;
  blocks: SSTableBlockView[];
}

export interface NodeState {
  id: string;
  shardId: string;
  role: RaftRole;
  currentTerm: number;
  votedFor: string | null;
  commitIndex: number;
  lastApplied: number;
  grpcPort: number;
  metricsPort: number;
  isHealthy: boolean;
  isPartitioned: boolean;
  electionTimeoutMs: number;
  timeSinceLastHeartbeat: number;
  log: RaftLogEntry[];
  walFrames: WalFrame[];
  memtable: SkipListNodeView[];
  immutableMemtables: SkipListNodeView[][];
  sstablesL0: SSTableView[];
  sstablesL1: SSTableView[];
  bloomChecks: number;
  bloomHits: number;
  compactionCount: number;
}

export interface ShardState {
  id: string;
  shardIndex: number;
  leaderId: string | null;
  nodes: NodeState[];
}

export interface ExecutionStep {
  stepNumber: number;
  title: string;
  description: string;
  nodeId?: string;
  shardId?: string;
  status: 'pending' | 'active' | 'success' | 'warning' | 'error';
  timestamp: number;
  details?: Record<string, any>;
}

export interface QueryResult {
  id: string;
  command: 'PUT' | 'GET' | 'DELETE';
  key: string;
  value?: string | null;
  shardIndex: number;
  targetNodeId: string;
  leaderId: string;
  success: boolean;
  found?: boolean;
  latencyMs: number;
  timestamp: number;
  steps: ExecutionStep[];
  error?: string;
}

export interface ClusterMetrics {
  totalWrites: number;
  totalReads: number;
  totalDeletes: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  qps: number;
  bloomHits: number;
  bloomChecks: number;
  compactions: number;
  historyQPS: { time: string; qps: number; latency: number }[];
}
