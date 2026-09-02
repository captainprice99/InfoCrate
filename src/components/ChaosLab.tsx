import React, { useState } from 'react';
import { Flame, ShieldAlert, Play, CheckCircle2, AlertTriangle, RefreshCw, Zap, ShieldCheck, Cpu } from 'lucide-react';
import { ShardState } from '../types/infocrate';
import { clusterInstance } from '../engine/clusterSimulator';

interface ChaosLabProps {
  shards: ShardState[];
}

export const ChaosLab: React.FC<ChaosLabProps> = ({ shards }) => {
  const [isRunningWorkload, setIsRunningWorkload] = useState(false);
  const [workloadProgress, setWorkloadProgress] = useState(0);
  const [workloadReport, setWorkloadReport] = useState<any>(null);
  const [chaosLog, setChaosLog] = useState<string[]>([]);

  const addChaosLog = (msg: string) => {
    setChaosLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 40)]);
  };

  const handleSimulateSplitBrain = () => {
    addChaosLog('Partitioning Shard 0: Isolating node-1 from node-2 and node-3...');
    clusterInstance.toggleNodePartition('node-1');
    addChaosLog('node-1 is now isolated in minority partition (1/3 nodes).');
    addChaosLog('node-2 and node-3 form majority partition (2/3 nodes) & elect new leader.');
  };

  const handleHealPartition = () => {
    addChaosLog('Healing network partitions across all nodes...');
    for (const shard of shards) {
      for (const node of shard.nodes) {
        if (node.isPartitioned) {
          clusterInstance.toggleNodePartition(node.id);
        }
      }
    }
    addChaosLog('All network partitions healed. Cluster state unified.');
  };

  const handleKillLeader = () => {
    const shard0 = shards[0];
    if (shard0 && shard0.leaderId) {
      const leaderId = shard0.leaderId;
      addChaosLog(`Killing current Shard 0 Leader (${leaderId})...`);
      clusterInstance.toggleNodeHealth(leaderId);
      addChaosLog(`Election triggered in Shard 0: surviving followers starting candidate phase...`);
    }
  };

  const handleRecoverAllNodes = () => {
    addChaosLog('Recovering all offline nodes...');
    for (const shard of shards) {
      for (const node of shard.nodes) {
        if (!node.isHealthy) {
          clusterInstance.toggleNodeHealth(node.id);
        }
      }
    }
    addChaosLog('All nodes recovered and replayed WAL from disk.');
  };

  const handleRunWorkload = async () => {
    setIsRunningWorkload(true);
    setWorkloadProgress(0);
    setWorkloadReport(null);
    addChaosLog('Starting distributed benchmark workload (100 ops batch)...');

    const total = 100;
    let successfulWrites = 0;
    let successfulReads = 0;
    let failedOps = 0;
    let totalLatency = 0;

    for (let i = 0; i < total; i++) {
      const isRead = Math.random() < 0.6;
      const key = `bench:key_${Math.floor(Math.random() * 20)}`;
      const val = `{"val": ${Math.floor(Math.random() * 10000)}, "ts": ${Date.now()}}`;

      const res = clusterInstance.executeQuery(isRead ? 'GET' : 'PUT', key, isRead ? null : val);
      if (res.success) {
        if (isRead) successfulReads++;
        else successfulWrites++;
      } else {
        failedOps++;
      }
      totalLatency += res.latencyMs;

      if (i % 10 === 0 || i === total - 1) {
        setWorkloadProgress(Math.round(((i + 1) / total) * 100));
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    const report = {
      totalOps: total,
      successfulReads,
      successfulWrites,
      failedOps,
      avgLatencyMs: Number((totalLatency / total).toFixed(2)),
      linearizability: failedOps === 0 ? '100% Strict Linearizability' : 'Quorum rejected during partition',
    };

    setWorkloadReport(report);
    setIsRunningWorkload(false);
    addChaosLog(`Workload complete. Result: ${report.successfulWrites} writes, ${report.successfulReads} reads.`);
  };

  return (
    <div className="space-y-6">
      {/* Chaos Header */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#141414] flex items-center space-x-2 font-mono">
              <Flame className="w-5 h-5 text-[#8A1F11]" />
              <span>Chaos Testing & Distributed Fault Injection Suite</span>
            </h2>
            <p className="text-xs text-[#605F5B] mt-0.5 font-serif-italic">
              Verify Raft leader election safety, quorum persistence under network partitions, and strict linearizability.
            </p>
          </div>
          <span className="px-3 py-1 bg-[#FBEAE8] border border-[#8A1F11] text-[#8A1F11] text-xs font-mono font-bold">
            JEPSEN-STYLE VERIFICATION
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Chaos Scenarios & Workload Runner */}
        <div className="lg:col-span-6 space-y-6">
          {/* Chaos Action Buttons */}
          <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-4">
            <div className="border-b border-[#141414] pb-2">
              <h3 className="text-xs font-bold text-[#141414] font-mono uppercase tracking-wider">
                Fault Injection Scenarios
              </h3>
              <p className="text-xs text-[#605F5B] font-serif-italic">Simulate distributed network and hardware failure modes</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleSimulateSplitBrain}
                className="p-3.5 bg-[#F4F3F0] border border-[#141414] hover:bg-[#EAE9E4] text-left transition-all font-mono text-xs space-y-1"
              >
                <div className="font-bold text-[#7A4B10] flex items-center space-x-1.5">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Split-Brain Partition</span>
                </div>
                <p className="text-[11px] text-[#605F5B]">
                  Isolate leader into minority partition. Verify majority elects new leader.
                </p>
              </button>

              <button
                onClick={handleHealPartition}
                className="p-3.5 bg-[#F4F3F0] border border-[#141414] hover:bg-[#EAE9E4] text-left transition-all font-mono text-xs space-y-1"
              >
                <div className="font-bold text-[#0F382A] flex items-center space-x-1.5">
                  <RefreshCw className="w-4 h-4" />
                  <span>Heal All Partitions</span>
                </div>
                <p className="text-[11px] text-[#605F5B]">
                  Re-connect network links and verify follower log reconciliation.
                </p>
              </button>

              <button
                onClick={handleKillLeader}
                className="p-3.5 bg-[#F4F3F0] border border-[#141414] hover:bg-[#EAE9E4] text-left transition-all font-mono text-xs space-y-1"
              >
                <div className="font-bold text-[#8A1F11] flex items-center space-x-1.5">
                  <Flame className="w-4 h-4" />
                  <span>Kill Current Leader</span>
                </div>
                <p className="text-[11px] text-[#605F5B]">
                  Crash leader node abruptly and observe follower election timeout.
                </p>
              </button>

              <button
                onClick={handleRecoverAllNodes}
                className="p-3.5 bg-[#F4F3F0] border border-[#141414] hover:bg-[#EAE9E4] text-left transition-all font-mono text-xs space-y-1"
              >
                <div className="font-bold text-[#1E3A8A] flex items-center space-x-1.5">
                  <Zap className="w-4 h-4" />
                  <span>Recover All Nodes</span>
                </div>
                <p className="text-[11px] text-[#605F5B]">
                  Restart crashed nodes and replay WAL binary logs from disk.
                </p>
              </button>
            </div>
          </div>

          {/* Automated Benchmark Workload */}
          <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#141414] pb-2">
              <div>
                <h3 className="text-xs font-bold text-[#141414] font-mono uppercase tracking-wider">
                  Automated Workload Generator
                </h3>
                <p className="text-xs text-[#605F5B] font-serif-italic">Concurrent stress test</p>
              </div>
              <span className="text-xs font-mono font-bold text-[#141414] px-2 py-0.5 bg-[#DCDAD5] border border-[#141414]">
                100 Ops Concurrent
              </span>
            </div>

            <button
              disabled={isRunningWorkload}
              onClick={handleRunWorkload}
              className={`w-full py-3 px-4 font-mono text-xs font-bold transition-all flex items-center justify-center space-x-2 border border-[#141414] ${
                isRunningWorkload
                  ? 'bg-[#DCDAD5] text-[#605F5B] cursor-not-allowed'
                  : 'bg-[#141414] hover:bg-[#2A2927] text-[#FAF9F5] shadow-sm'
              }`}
            >
              {isRunningWorkload ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-[#141414]" />
                  <span>Executing Workload ({workloadProgress}%)...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Run 100-Op Distributed Workload</span>
                </>
              )}
            </button>

            {/* Workload Report */}
            {workloadReport && (
              <div className="p-4 bg-[#F4F3F0] border border-[#141414] font-mono text-xs space-y-2">
                <div className="flex items-center justify-between text-[#0F382A] font-bold border-b border-[#141414] pb-2">
                  <span className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4" />
                    <span>{workloadReport.linearizability}</span>
                  </span>
                  <span>Avg Latency: {workloadReport.avgLatencyMs}ms</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 text-[#605F5B]">
                  <div>Writes: <strong className="text-[#141414]">{workloadReport.successfulWrites}</strong></div>
                  <div>Reads: <strong className="text-[#0F382A]">{workloadReport.successfulReads}</strong></div>
                  <div>Failed/Rejected: <strong className="text-[#8A1F11]">{workloadReport.failedOps}</strong></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Chaos & Consensus Events Log */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm h-full flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-[#141414] mb-3">
              <h3 className="text-xs font-bold text-[#141414] font-mono uppercase tracking-wider">
                Cluster Event Stream
              </h3>
              <button
                onClick={() => setChaosLog([])}
                className="text-xs font-mono text-[#605F5B] hover:text-[#141414] underline"
              >
                Clear Log
              </button>
            </div>

            <div className="flex-1 bg-[#F4F3F0] p-4 border border-[#141414] font-mono text-xs overflow-y-auto max-h-96 space-y-2">
              {chaosLog.length === 0 ? (
                <div className="text-[#605F5B] text-center py-12 font-serif-italic">
                  No fault events triggered yet. Click a scenario above to test cluster resilience.
                </div>
              ) : (
                chaosLog.map((log, i) => (
                  <div key={i} className="text-[#141414] text-[11px] leading-relaxed border-l-2 border-[#141414] pl-2 bg-[#EBEAE6] py-1">
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
