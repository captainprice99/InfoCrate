import React, { useState } from 'react';
import { Layers, FileCode, CheckCircle, Search, Binary, Hash, RefreshCw, HardDrive, ArrowDown, Database, Cpu } from 'lucide-react';
import { ShardState, NodeState, SSTableView } from '../types/infocrate';
import { clusterInstance } from '../engine/clusterSimulator';
import { fnv1a64, murmur3_64 } from '../engine/crc32';

interface LsmInspectorProps {
  shards: ShardState[];
}

export const LsmInspector: React.FC<LsmInspectorProps> = ({ shards }) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('node-1');
  const [lsmSubTab, setLsmSubTab] = useState<'skiplist' | 'wal' | 'sstables' | 'bloom' | 'compaction'>('skiplist');
  const [bloomTestKey, setBloomTestKey] = useState('user:1001');

  const allNodes = shards.flatMap((s) => s.nodes);
  const activeNode = allNodes.find((n) => n.id === selectedNodeId) || allNodes[0];

  // Bloom Filter test calculations for active node
  const bloomH1 = Number(fnv1a64(bloomTestKey) % 64n);
  const bloomH2 = Number(murmur3_64(bloomTestKey) % 64n);
  const bloomBitIndices = [0, 1, 2, 3].map((i) => Math.abs((bloomH1 + i * bloomH2) % 64));

  return (
    <div className="space-y-6">
      {/* Node Selector and LSM Sub-nav */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-[#141414] text-[#E4E3E0] border border-[#141414] flex items-center justify-center font-mono">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#141414] font-mono">LSM-Tree Storage Engine Inspector</h2>
            <p className="text-xs text-[#605F5B] font-serif-italic">
              Inspect Memtable Skip List, WAL binary frames, SSTables, Bloom filters, and compaction.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <label className="text-xs font-mono font-bold text-[#605F5B] uppercase">Node Target:</label>
          <select
            value={selectedNodeId}
            onChange={(e) => setSelectedNodeId(e.target.value)}
            className="bg-[#FFFFFF] border border-[#141414] text-[#141414] font-mono text-xs px-3 py-1.5 focus:outline-none"
          >
            {allNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} ({n.shardId} &bull; {n.role})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex space-x-1 border-b border-[#141414] pb-2 overflow-x-auto text-xs font-mono">
        <button
          onClick={() => setLsmSubTab('skiplist')}
          className={`px-3 py-1.5 border font-medium transition-all whitespace-nowrap ${
            lsmSubTab === 'skiplist'
              ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
              : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
          }`}
        >
          1. Concurrent Skip List (Memtable)
        </button>
        <button
          onClick={() => setLsmSubTab('wal')}
          className={`px-3 py-1.5 border font-medium transition-all whitespace-nowrap ${
            lsmSubTab === 'wal'
              ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
              : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
          }`}
        >
          2. WAL Binary Frame Format (CRC32)
        </button>
        <button
          onClick={() => setLsmSubTab('sstables')}
          className={`px-3 py-1.5 border font-medium transition-all whitespace-nowrap ${
            lsmSubTab === 'sstables'
              ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
              : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
          }`}
        >
          3. SSTables & Sparse Block Index
        </button>
        <button
          onClick={() => setLsmSubTab('bloom')}
          className={`px-3 py-1.5 border font-medium transition-all whitespace-nowrap ${
            lsmSubTab === 'bloom'
              ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
              : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
          }`}
        >
          4. In-Memory Bloom Filters
        </button>
        <button
          onClick={() => setLsmSubTab('compaction')}
          className={`px-3 py-1.5 border font-medium transition-all whitespace-nowrap ${
            lsmSubTab === 'compaction'
              ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
              : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
          }`}
        >
          5. Leveled Compaction Worker
        </button>
      </div>

      {/* Sub-Tab 1: Skip List Memtable */}
      {lsmSubTab === 'skiplist' && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[#141414] gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#141414] font-mono flex items-center space-x-2">
                <span>Active Memtable (Concurrent Skip List)</span>
                <span className="text-xs px-2 py-0.5 bg-[#DCDAD5] text-[#141414] border border-[#141414] font-normal">
                  {activeNode.memtable.length} Active Records
                </span>
              </h3>
              <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
                Protected via sync.RWMutex. Geometric level distribution (p=0.5) ensures O(log N) operations.
              </p>
            </div>
            <button
              onClick={() => clusterInstance.flushMemtable(activeNode.id)}
              className="px-3 py-1.5 text-xs font-mono font-medium bg-[#141414] hover:bg-[#2A2A2A] text-[#E4E3E0] border border-[#141414] flex items-center space-x-1.5 transition-all active:translate-y-0.5"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Flush to Immutable &rarr; SSTable L0</span>
            </button>
          </div>

          {/* Visual Skip List Levels Diagram */}
          <div className="space-y-3 overflow-x-auto pb-2">
            <div className="text-xs font-mono font-bold text-[#605F5B] uppercase tracking-wider">
              Multi-Level Forward Pointer Structure
            </div>
            <div className="min-w-[600px] space-y-2 bg-[#F4F3F0] p-4 border border-[#141414] font-mono text-xs">
              {[4, 3, 2, 1].map((lvl) => (
                <div key={lvl} className="flex items-center space-x-2">
                  <div className="w-16 text-[#605F5B] font-bold shrink-0">Level {lvl}:</div>
                  <div className="flex items-center space-x-2 flex-1">
                    <span className="px-2 py-1 bg-[#DCDAD5] text-[#141414] border border-[#141414] text-[10px] font-bold">
                      HEAD
                    </span>
                    <span className="text-[#605F5B]">&rarr;</span>
                    {activeNode.memtable.map((entry) => {
                      const present = entry.height >= lvl;
                      return (
                        <div key={entry.key} className="flex items-center space-x-2">
                          <div
                            className={`px-2.5 py-1 text-[11px] font-mono font-semibold transition-all border ${
                              present
                                ? entry.isTombstone
                                  ? 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                                  : 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                                : 'bg-transparent text-[#A09F9B] border border-[#DCDAD5] border-dashed'
                            }`}
                          >
                            {present ? (
                              <span>
                                {entry.key} {entry.isTombstone && '(DEL)'}
                              </span>
                            ) : (
                              <span className="text-[#A09F9B]">&bull;&bull;&bull;</span>
                            )}
                          </div>
                          <span className="text-[#605F5B]">&rarr;</span>
                        </div>
                      );
                    })}
                    <span className="px-2 py-1 bg-[#EBEAE6] text-[#605F5B] border border-[#141414]/30 text-[10px]">NIL</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Table of Memtable Entries */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono border-collapse border border-[#141414]">
              <thead>
                <tr className="bg-[#DCDAD5] text-[#141414] border-b border-[#141414]">
                  <th className="p-2.5 border-r border-[#141414]">Key</th>
                  <th className="p-2.5 border-r border-[#141414]">Value Payload</th>
                  <th className="p-2.5 border-r border-[#141414]">Skip Height</th>
                  <th className="p-2.5 border-r border-[#141414]">Timestamp (Unix Nano)</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141414]/30 bg-[#F4F3F0]">
                {activeNode.memtable.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-[#605F5B]">
                      Memtable is currently empty (recently flushed to SSTables).
                    </td>
                  </tr>
                ) : (
                  activeNode.memtable.map((node) => (
                    <tr key={node.key} className="hover:bg-[#EAE9E4]">
                      <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">{node.key}</td>
                      <td className="p-2.5 text-[#605F5B] max-w-sm truncate border-r border-[#141414]/30">
                        {node.isTombstone ? '<Tombstone Marker>' : node.value}
                      </td>
                      <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{node.height} levels</td>
                      <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">{node.timestamp}</td>
                      <td className="p-2.5">
                        {node.isTombstone ? (
                          <span className="text-[#7A1D1D] font-bold">Tombstone (Deleted)</span>
                        ) : (
                          <span className="text-[#0F382A] font-bold">Active Key</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: WAL Binary Frames */}
      {lsmSubTab === 'wal' && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-6">
          <div className="pb-4 border-b border-[#141414]">
            <h3 className="text-sm font-bold text-[#141414] font-mono flex items-center space-x-2">
              <Binary className="w-4 h-4 text-[#141414]" />
              <span>Write-Ahead Log (WAL) Binary Specification</span>
            </h3>
            <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
              Every committed write is fsync'd before memtable insertion to guarantee 100% crash durability.
            </p>
          </div>

          {/* Specification Header */}
          <div className="bg-[#F4F3F0] p-4 border border-[#141414] font-mono text-xs space-y-2">
            <span className="text-[#141414] font-bold block uppercase tracking-wider text-[11px]">
              Frame Layout:
            </span>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <div className="px-2.5 py-1.5 bg-[#E7ECF3] border border-[#1E3A8A] text-[#1E3A8A] font-bold">
                CRC32 (4B) &bull; IEEE
              </div>
              <div className="px-2.5 py-1.5 bg-[#F3E8FF] border border-[#6B21A8] text-[#6B21A8] font-bold">
                Timestamp (8B) &bull; Nano
              </div>
              <div className="px-2.5 py-1.5 bg-[#E2ECE9] border border-[#0F382A] text-[#0F382A] font-bold">
                Key Size (4B)
              </div>
              <div className="px-2.5 py-1.5 bg-[#FEF3C7] border border-[#7A4B10] text-[#7A4B10] font-bold">
                Value Size (4B)
              </div>
              <div className="px-2.5 py-1.5 bg-[#EBEAE6] border border-[#141414] text-[#141414]">
                Key Payload (VarBytes)
              </div>
              <div className="px-2.5 py-1.5 bg-[#EBEAE6] border border-[#141414] text-[#141414]">
                Value Payload (VarBytes)
              </div>
            </div>
          </div>

          {/* WAL Frames Stream */}
          <div className="space-y-3">
            <span className="text-xs font-mono font-bold text-[#605F5B] uppercase tracking-wider">
              Recent WAL Frames on Disk (Offset Order)
            </span>
            <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
              {activeNode.walFrames.map((frame, idx) => (
                <div
                  key={idx}
                  className="p-3.5 bg-[#F4F3F0] border border-[#141414] font-mono text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-[#141414] font-bold">Offset {frame.offset}B</span>
                      <span className="text-[#605F5B]">&bull;</span>
                      <span className="text-[#141414] font-bold">{frame.key}</span>
                      <span className="text-[#605F5B]">&bull;</span>
                      <span className="text-[#605F5B]">{frame.isTombstone ? '<TOMBSTONE>' : `${frame.valSize} bytes`}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-[#0F382A] font-bold flex items-center space-x-1">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>CRC32: {frame.crc32}</span>
                      </span>
                    </div>
                  </div>
                  <div className="p-2 bg-[#FFFFFF] border border-[#141414]/40 text-[11px] text-[#141414] break-all">
                    <span className="text-[#605F5B] select-none font-bold">RAW HEX: </span>
                    <span className="text-[#141414]">{frame.rawHex}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: SSTables */}
      {lsmSubTab === 'sstables' && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-[#141414] gap-2">
            <div>
              <h3 className="text-sm font-bold text-[#141414] font-mono flex items-center space-x-2">
                <HardDrive className="w-4 h-4 text-[#141414]" />
                <span>On-Disk SSTables & Sparse Block Indexes</span>
              </h3>
              <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
                Level 0 (overlapping) & Level 1 (partitioned non-overlapping key ranges).
              </p>
            </div>
            <button
              onClick={() => clusterInstance.triggerCompaction(activeNode.id)}
              className="px-3 py-1.5 text-xs font-mono font-medium bg-[#141414] hover:bg-[#2A2A2A] text-[#E4E3E0] border border-[#141414] flex items-center space-x-1.5 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Compact L0 &rarr; L1</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* L0 SSTables */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#141414] pb-1">
                <h4 className="text-xs font-mono font-bold text-[#141414] uppercase tracking-wider">
                  Level 0 SSTables ({activeNode.sstablesL0.length})
                </h4>
                <span className="text-[11px] text-[#605F5B] font-mono">Flush Target</span>
              </div>

              {activeNode.sstablesL0.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono text-[#605F5B] bg-[#F4F3F0] border border-[#141414]">
                  No Level 0 SSTables currently. (Click "Flush Memtable" to create).
                </div>
              ) : (
                activeNode.sstablesL0.map((table) => (
                  <SSTableCard key={table.filename} table={table} />
                ))
              )}
            </div>

            {/* L1 SSTables */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#141414] pb-1">
                <h4 className="text-xs font-mono font-bold text-[#141414] uppercase tracking-wider">
                  Level 1 Compacted SSTables ({activeNode.sstablesL1.length})
                </h4>
                <span className="text-[11px] text-[#605F5B] font-mono">Sorted Run</span>
              </div>

              {activeNode.sstablesL1.length === 0 ? (
                <div className="p-6 text-center text-xs font-mono text-[#605F5B] bg-[#F4F3F0] border border-[#141414]">
                  No Level 1 SSTables yet. (Compaction merges L0 into L1).
                </div>
              ) : (
                activeNode.sstablesL1.map((table) => (
                  <SSTableCard key={table.filename} table={table} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 4: Bloom Filters */}
      {lsmSubTab === 'bloom' && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-6">
          <div className="pb-4 border-b border-[#141414]">
            <h3 className="text-sm font-bold text-[#141414] font-mono flex items-center space-x-2">
              <Hash className="w-4 h-4 text-[#141414]" />
              <span>In-Memory Bloom Filter Inspector</span>
            </h3>
            <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
              Double hashing with FNV-1a and Murmur3 eliminates 99% of negative disk reads.
            </p>
          </div>

          {/* Test Input */}
          <div className="bg-[#F4F3F0] p-5 border border-[#141414] space-y-4">
            <label className="block text-xs font-mono font-bold text-[#141414] uppercase tracking-wider">
              Test Key Membership & Hash Computation
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={bloomTestKey}
                onChange={(e) => setBloomTestKey(e.target.value)}
                placeholder="Enter key to test bloom filter..."
                className="flex-1 bg-[#FFFFFF] border border-[#141414] px-3.5 py-2 text-xs font-mono text-[#141414] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs pt-2">
              <div className="p-3 bg-[#EBEAE6] border border-[#141414]">
                <span className="text-[#605F5B] block text-[11px] font-bold">FNV-1a Hash (h1):</span>
                <span className="text-[#141414] font-bold text-sm">{bloomH1}</span>
              </div>
              <div className="p-3 bg-[#EBEAE6] border border-[#141414]">
                <span className="text-[#605F5B] block text-[11px] font-bold">Murmur3 Hash (h2):</span>
                <span className="text-[#141414] font-bold text-sm">{bloomH2}</span>
              </div>
              <div className="p-3 bg-[#EBEAE6] border border-[#141414]">
                <span className="text-[#605F5B] block text-[11px] font-bold">Bit Indices (k=4):</span>
                <span className="text-[#0F382A] font-bold text-sm">{bloomBitIndices.join(', ')}</span>
              </div>
            </div>
          </div>

          {/* 64-Bit Array Visualization */}
          <div className="space-y-2">
            <span className="text-xs font-mono font-bold text-[#605F5B] uppercase tracking-wider block">
              64-Bit Array Representation (Active Filter Block)
            </span>
            <div className="grid grid-cols-8 sm:grid-cols-16 gap-1 bg-[#F4F3F0] p-4 border border-[#141414]">
              {Array.from({ length: 64 }).map((_, idx) => {
                const isTargetBit = bloomBitIndices.includes(idx);
                return (
                  <div
                    key={idx}
                    title={`Bit ${idx}`}
                    className={`h-8 flex items-center justify-center font-mono text-[10px] font-bold transition-all border ${
                      isTargetBit
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-sm'
                        : 'bg-[#FFFFFF] text-[#605F5B] border-[#141414]/30'
                    }`}
                  >
                    {idx}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 5: Compaction */}
      {lsmSubTab === 'compaction' && (
        <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-6">
          <div className="pb-4 border-b border-[#141414]">
            <h3 className="text-sm font-bold text-[#141414] font-mono flex items-center space-x-2">
              <RefreshCw className="w-4 h-4 text-[#141414]" />
              <span>Multi-Way Merge Compaction & Tombstone GC</span>
            </h3>
            <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
              Merges overlapping Level 0 SSTables into sorted Level 1 runs and reclaims disk space by discarding tombstones.
            </p>
          </div>

          <div className="p-5 bg-[#F4F3F0] border border-[#141414] font-mono text-xs space-y-4">
            <h4 className="font-bold text-[#141414] uppercase tracking-wider text-[11px] border-b border-[#141414] pb-1">
              Compaction Pipeline Lifecycle
            </h4>
            <div className="space-y-3">
              <div className="p-3 bg-[#EBEAE6] border border-[#141414] flex items-start space-x-3">
                <div className="w-6 h-6 bg-[#141414] text-[#E4E3E0] border border-[#141414] flex items-center justify-center font-bold shrink-0">
                  1
                </div>
                <div>
                  <div className="font-bold text-[#141414]">Level 0 Threshold Trigger</div>
                  <div className="text-[#605F5B] text-[11px] mt-0.5">
                    When L0 table count reaches 4, background worker initiates compaction task.
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#EBEAE6] border border-[#141414] flex items-start space-x-3">
                <div className="w-6 h-6 bg-[#141414] text-[#E4E3E0] border border-[#141414] flex items-center justify-center font-bold shrink-0">
                  2
                </div>
                <div>
                  <div className="font-bold text-[#141414]">K-Way Sorted Merge</div>
                  <div className="text-[#605F5B] text-[11px] mt-0.5">
                    Reads candidate tables, sorts by Key ascending and Timestamp descending to retain only the newest version per key.
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#EBEAE6] border border-[#141414] flex items-start space-x-3">
                <div className="w-6 h-6 bg-[#141414] text-[#E4E3E0] border border-[#141414] flex items-center justify-center font-bold shrink-0">
                  3
                </div>
                <div>
                  <div className="font-bold text-[#141414]">Tombstone Garbage Collection</div>
                  <div className="text-[#605F5B] text-[11px] mt-0.5">
                    Tombstones reaching the bottom level are dropped, reclaiming disk space without leaking deletions.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface SSTableCardProps {
  table: SSTableView;
}

const SSTableCard: React.FC<SSTableCardProps> = ({ table }) => {
  return (
    <div className="p-4 bg-[#F4F3F0] border border-[#141414] font-mono text-xs space-y-3">
      <div className="flex items-center justify-between border-b border-[#141414]/30 pb-2">
        <span className="font-bold text-[#141414]">{table.filename}</span>
        <span className="text-[#605F5B] text-[11px] font-bold">{table.fileBytes} bytes</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-[#605F5B]">
        <div>Key Range: <span className="text-[#141414] font-bold">[{table.minKey} &rarr; {table.maxKey}]</span></div>
        <div>Entries: <span className="text-[#141414] font-bold">{table.entryCount}</span></div>
      </div>

      <div className="pt-2 border-t border-[#141414]/30 space-y-1">
        <span className="text-[10px] text-[#605F5B] uppercase font-bold block">Data Blocks:</span>
        <div className="space-y-1">
          {table.blocks.map((b) => (
            <div
              key={b.blockIndex}
              className="p-1.5 bg-[#FFFFFF] border border-[#141414]/30 flex items-center justify-between text-[11px]"
            >
              <span className="font-medium text-[#141414]">Block #{b.blockIndex} (Offset: {b.offset}B)</span>
              <span className="text-[#605F5B]">LastKey: {b.lastKey}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
