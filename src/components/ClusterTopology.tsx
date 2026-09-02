import React, { useState } from 'react';
import { Server, ShieldCheck, Activity, Power, WifiOff, RefreshCw, Layers, HardDrive, FileText, ChevronRight } from 'lucide-react';
import { ShardState, NodeState } from '../types/infocrate';
import { clusterInstance } from '../engine/clusterSimulator';

interface ClusterTopologyProps {
  shards: ShardState[];
}

export const ClusterTopology: React.FC<ClusterTopologyProps> = ({ shards }) => {
  const [selectedNode, setSelectedNode] = useState<NodeState | null>(shards[0]?.nodes[0] || null);

  return (
    <div className="space-y-6">
      {/* Topology Header */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#141414] flex items-center space-x-2 font-mono">
              <span>Cluster Topology & Raft State Machines</span>
            </h2>
            <p className="text-xs text-[#605F5B] mt-0.5 font-serif-italic">
              Each shard forms an independent Raft consensus group ensuring strict quorum replication (N/2 + 1).
            </p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="flex items-center space-x-1.5 px-3 py-1 bg-[#E2ECE9] border border-[#0F382A] text-[#0F382A] font-bold">
              <span className="w-2 h-2 bg-[#0F382A] animate-pulse"></span>
              <span>HEARTBEAT: 50ms</span>
            </span>
            <span className="px-3 py-1 bg-[#F4F3F0] border border-[#141414] text-[#605F5B]">
              TIMEOUT: 150-300ms
            </span>
          </div>
        </div>
      </div>

      {/* Shards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {shards.map((shard) => {
          const healthyCount = shard.nodes.filter((n) => n.isHealthy && !n.isPartitioned).length;
          const quorumMet = healthyCount >= Math.floor(shard.nodes.length / 2) + 1;

          return (
            <div
              key={shard.id}
              className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm space-y-4"
            >
              {/* Shard Bar */}
              <div className="flex items-center justify-between border-b border-[#141414] pb-3">
                <div className="flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-[#141414]" />
                  <div>
                    <h3 className="text-xs font-bold text-[#141414] font-mono uppercase tracking-wider">
                      Shard {shard.shardIndex} ({shard.id})
                    </h3>
                    <span className="text-[11px] text-[#605F5B] font-mono">
                      Raft Group {shard.shardIndex} &bull; {shard.nodes.length} Replicas
                    </span>
                  </div>
                </div>

                <div className="flex items-center space-x-2 font-mono text-xs">
                  <span
                    className={`px-2.5 py-0.5 text-[11px] font-bold border ${
                      quorumMet
                        ? 'bg-[#E2ECE9] text-[#0F382A] border-[#0F382A]'
                        : 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                    }`}
                  >
                    {quorumMet ? `Quorum OK (${healthyCount}/${shard.nodes.length})` : 'Quorum Lost'}
                  </span>
                </div>
              </div>

              {/* Node Cards */}
              <div className="space-y-3">
                {shard.nodes.map((node) => {
                  const isLeader = node.role === 'LEADER';
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className={`p-3.5 border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-md'
                          : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414]'
                      } ${!node.isHealthy ? 'opacity-60 border-dashed border-[#7A1D1D]' : ''}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`w-8 h-8 flex items-center justify-center font-mono font-bold text-xs border ${
                              !node.isHealthy
                                ? 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                                : node.isPartitioned
                                ? 'bg-[#FEF3C7] text-[#7A4B10] border-[#7A4B10]'
                                : isLeader
                                ? isSelected
                                  ? 'bg-[#E2ECE9] text-[#0F382A] border-[#E4E3E0]'
                                  : 'bg-[#E2ECE9] text-[#0F382A] border-[#0F382A]'
                                : isSelected
                                ? 'bg-[#2A2A2A] text-[#E4E3E0] border-[#444444]'
                                : 'bg-[#EBEAE6] text-[#141414] border-[#141414]'
                            }`}
                          >
                            <Server className="w-4 h-4" />
                          </div>

                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="text-sm font-bold font-mono">{node.id}</span>
                              <span
                                className={`text-[10px] font-mono font-bold px-1.5 py-0.2 border uppercase ${
                                  !node.isHealthy
                                    ? 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                                    : node.isPartitioned
                                    ? 'bg-[#FEF3C7] text-[#7A4B10] border-[#7A4B10]'
                                    : isLeader
                                    ? 'bg-[#0F382A] text-[#FFFFFF] border-[#0F382A]'
                                    : isSelected
                                    ? 'bg-[#2A2A2A] text-[#A0A0A0] border-[#444444]'
                                    : 'bg-[#DCDAD5] text-[#605F5B] border-[#141414]/40'
                                }`}
                              >
                                {!node.isHealthy ? 'OFFLINE' : node.isPartitioned ? 'PARTITIONED' : node.role}
                              </span>
                            </div>

                            <div className={`flex items-center space-x-3 text-[11px] font-mono mt-1 ${isSelected ? 'text-[#C0BFBC]' : 'text-[#605F5B]'}`}>
                              <span>Term: <strong className={isSelected ? 'text-[#FFFFFF]' : 'text-[#141414]'}>{node.currentTerm}</strong></span>
                              <span>CommitIdx: <strong className={isSelected ? 'text-[#FFFFFF]' : 'text-[#141414]'}>{node.commitIndex}</strong></span>
                              <span>Port: {node.grpcPort}</span>
                            </div>
                          </div>
                        </div>

                        {/* Node Controls */}
                        <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            title={node.isHealthy ? 'Kill / Stop Node' : 'Restart / Recover Node'}
                            onClick={() => clusterInstance.toggleNodeHealth(node.id)}
                            className={`p-1.5 border text-xs transition-all ${
                              node.isHealthy
                                ? isSelected
                                  ? 'bg-[#2A2A2A] hover:bg-[#7A1D1D] text-[#E4E3E0] border-[#555555]'
                                  : 'bg-[#F4F3F0] hover:bg-[#FCE8E6] hover:text-[#7A1D1D] text-[#141414] border-[#141414]'
                                : 'bg-[#E2ECE9] hover:bg-[#0F382A] hover:text-[#FFFFFF] text-[#0F382A] border-[#0F382A]'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title={node.isPartitioned ? 'Rejoin Network' : 'Isolate Network Partition'}
                            onClick={() => clusterInstance.toggleNodePartition(node.id)}
                            className={`p-1.5 border text-xs transition-all ${
                              node.isPartitioned
                                ? 'bg-[#FEF3C7] text-[#7A4B10] border-[#7A4B10]'
                                : isSelected
                                ? 'bg-[#2A2A2A] hover:bg-[#7A4B10] text-[#E4E3E0] border-[#555555]'
                                : 'bg-[#F4F3F0] hover:bg-[#FEF3C7] hover:text-[#7A4B10] text-[#141414] border-[#141414]'
                            }`}
                          >
                            <WifiOff className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Storage Summary Mini Bar */}
                      <div className={`mt-3 pt-2.5 border-t grid grid-cols-4 gap-2 text-[10px] font-mono ${
                        isSelected ? 'border-[#333333] text-[#A0A0A0]' : 'border-[#141414]/20 text-[#605F5B]'
                      }`}>
                        <div>Memtable: <span className={isSelected ? 'text-[#FFFFFF] font-bold' : 'text-[#141414] font-bold'}>{node.memtable.length} keys</span></div>
                        <div>WAL: <span className={isSelected ? 'text-[#FFFFFF] font-bold' : 'text-[#141414] font-bold'}>{node.walFrames.length} frames</span></div>
                        <div>L0 SSTs: <span className={isSelected ? 'text-[#FFFFFF] font-bold' : 'text-[#141414] font-bold'}>{node.sstablesL0.length}</span></div>
                        <div>L1 SSTs: <span className={isSelected ? 'text-[#FFFFFF] font-bold' : 'text-[#141414] font-bold'}>{node.sstablesL1.length}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Node Details & Raft Log Inspector */}
      {selectedNode && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[#141414] gap-2">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-[#141414] text-[#E4E3E0] border border-[#141414] flex items-center justify-center font-mono">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#141414] font-mono">
                  {selectedNode.id} &mdash; Raft Consensus Log & Storage State
                </h3>
                <p className="text-xs text-[#605F5B] font-serif-italic">
                  Replicated log sequence applied to the local LSM storage engine on quorum commit.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => clusterInstance.flushMemtable(selectedNode.id)}
                className="px-3 py-1.5 text-xs font-mono font-medium bg-[#F4F3F0] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] border border-[#141414] flex items-center space-x-1.5 transition-all"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Flush Memtable &rarr; L0</span>
              </button>
              <button
                onClick={() => clusterInstance.triggerCompaction(selectedNode.id)}
                className="px-3 py-1.5 text-xs font-mono font-medium bg-[#F4F3F0] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] border border-[#141414] flex items-center space-x-1.5 transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Compact (L0 &rarr; L1)</span>
              </button>
            </div>
          </div>

          {/* Raft Replicated Log Entries Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse border border-[#141414]">
              <thead>
                <tr className="bg-[#DCDAD5] text-[#141414] border-b border-[#141414]">
                  <th className="p-2.5 border-r border-[#141414]">Log Index</th>
                  <th className="p-2.5 border-r border-[#141414]">Raft Term</th>
                  <th className="p-2.5 border-r border-[#141414]">Command</th>
                  <th className="p-2.5 border-r border-[#141414]">Key</th>
                  <th className="p-2.5 border-r border-[#141414]">Value Payload</th>
                  <th className="p-2.5">Commit Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/30 bg-[#F4F3F0]">
                {selectedNode.log.map((entry) => {
                  const isCommitted = entry.index <= selectedNode.commitIndex;
                  return (
                    <tr key={entry.index} className="hover:bg-[#EAE9E4]">
                      <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">#{entry.index}</td>
                      <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Term {entry.term}</td>
                      <td className="p-2.5 border-r border-[#141414]/30">
                        <span
                          className={`px-1.5 py-0.2 text-[10px] font-bold border ${
                            entry.commandType === 'PUT'
                              ? 'bg-[#E2ECE9] text-[#0F382A] border-[#0F382A]'
                              : 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                          }`}
                        >
                          {entry.commandType}
                        </span>
                      </td>
                      <td className="p-2.5 text-[#141414] font-semibold border-r border-[#141414]/30">{entry.key}</td>
                      <td className="p-2.5 text-[#605F5B] max-w-xs truncate border-r border-[#141414]/30">{entry.value || '<Tombstone>'}</td>
                      <td className="p-2.5">
                        {isCommitted ? (
                          <span className="inline-flex items-center space-x-1 text-[#0F382A] font-bold">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Committed</span>
                          </span>
                        ) : (
                          <span className="text-[#888888]">Uncommitted</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
