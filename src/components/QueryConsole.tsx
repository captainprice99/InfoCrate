import React, { useState } from 'react';
import { Play, RotateCcw, CheckCircle2, AlertCircle, Clock, ArrowRight, Server, Shield, Hash, FileCode } from 'lucide-react';
import { ShardState, QueryResult } from '../types/infocrate';
import { clusterInstance } from '../engine/clusterSimulator';
import { fnv1a64 } from '../engine/crc32';

interface QueryConsoleProps {
  shards: ShardState[];
  queryHistory: QueryResult[];
}

export const QueryConsole: React.FC<QueryConsoleProps> = ({ shards, queryHistory }) => {
  const [command, setCommand] = useState<'PUT' | 'GET' | 'DELETE'>('PUT');
  const [key, setKey] = useState('user:1005');
  const [value, setValue] = useState('{\n  "name": "Eve Developer",\n  "team": "Distributed Systems",\n  "status": "Active"\n}');
  const [activeResult, setActiveResult] = useState<QueryResult | null>(queryHistory[0] || null);

  const hashVal = key.trim() ? fnv1a64(key.trim()) : 0n;
  const targetShard = Number(hashVal % BigInt(shards.length || 1));
  const currentLeader = shards[targetShard]?.leaderId || 'None (No Quorum)';

  const handleExecute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;

    const res = clusterInstance.executeQuery(
      command,
      key.trim(),
      command === 'PUT' ? value.trim() : null
    );
    setActiveResult(res);
  };

  const loadSample = (cmd: 'PUT' | 'GET' | 'DELETE', sampleKey: string, sampleVal?: string) => {
    setCommand(cmd);
    setKey(sampleKey);
    if (sampleVal) setValue(sampleVal);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Route Preview */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#141414] flex items-center space-x-2 font-mono">
              <span className="bg-[#141414] text-[#E4E3E0] px-2 py-0.5 text-xs font-bold">gRPC Client</span>
              <span className="text-[#605F5B]">/</span>
              <span>Cluster Request Router</span>
            </h2>
            <p className="text-xs text-[#605F5B] mt-1 font-serif-italic">
              Deterministic 64-bit hashing routes requests directly to the authoritative Raft shard leader.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="px-3 py-1.5 bg-[#F4F3F0] border border-[#141414] text-[#141414] flex items-center space-x-2">
              <Hash className="w-3.5 h-3.5 text-[#141414]" />
              <span className="text-[#605F5B]">FNV-1a:</span>
              <span className="font-bold">{hashVal.toString(16).substring(0, 10)}...</span>
            </div>
            <div className="px-3 py-1.5 bg-[#F4F3F0] border border-[#141414] text-[#141414] flex items-center space-x-2">
              <ArrowRight className="w-3.5 h-3.5 text-[#7A4B10]" />
              <span className="text-[#605F5B]">Target:</span>
              <span className="font-bold text-[#7A4B10]">Shard {targetShard}</span>
            </div>
            <div className="px-3 py-1.5 bg-[#F4F3F0] border border-[#141414] text-[#141414] flex items-center space-x-2">
              <Server className="w-3.5 h-3.5 text-[#0F382A]" />
              <span className="text-[#605F5B]">Leader:</span>
              <span className="font-bold text-[#0F382A]">{currentLeader}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Command Form & Presets */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm">
            <h3 className="text-xs font-bold text-[#141414] uppercase tracking-wider mb-4 flex items-center justify-between font-mono border-b border-[#141414] pb-2">
              <span>Execute Request</span>
              <span className="text-xs font-mono text-[#605F5B] font-normal">Proto3 gRPC Service</span>
            </h3>

            <form onSubmit={handleExecute} className="space-y-4">
              {/* Command Selector */}
              <div>
                <label className="block text-xs font-mono text-[#605F5B] mb-1.5 uppercase font-semibold">Command Method</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCommand('PUT')}
                    className={`py-2 px-3 text-xs font-mono font-bold border transition-all ${
                      command === 'PUT'
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                        : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
                    }`}
                  >
                    PUT(key, value)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommand('GET')}
                    className={`py-2 px-3 text-xs font-mono font-bold border transition-all ${
                      command === 'GET'
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                        : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
                    }`}
                  >
                    GET(key)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommand('DELETE')}
                    className={`py-2 px-3 text-xs font-mono font-bold border transition-all ${
                      command === 'DELETE'
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                        : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
                    }`}
                  >
                    DELETE(key)
                  </button>
                </div>
              </div>

              {/* Key Input */}
              <div>
                <label className="block text-xs font-mono text-[#605F5B] mb-1.5 uppercase font-semibold">Key Identifier</label>
                <div className="relative">
                  <input
                    id="input-query-key"
                    type="text"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="e.g. user:1005"
                    className="w-full bg-[#FFFFFF] border border-[#141414] px-3.5 py-2.5 text-xs font-mono text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#141414]"
                    required
                  />
                </div>
              </div>

              {/* Value Input (Only for PUT) */}
              {command === 'PUT' && (
                <div>
                  <label className="block text-xs font-mono text-[#605F5B] mb-1.5 flex justify-between uppercase font-semibold">
                    <span>Value Payload (JSON / Binary Bytes)</span>
                    <span className="text-[#605F5B] font-mono text-[11px] font-normal">{new TextEncoder().encode(value).length} bytes</span>
                  </label>
                  <textarea
                    id="input-query-value"
                    rows={4}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder='{"key": "value"}'
                    className="w-full bg-[#FFFFFF] border border-[#141414] p-3 text-xs font-mono text-[#141414] focus:outline-none focus:ring-1 focus:ring-[#141414]"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center space-x-3 pt-2">
                <button
                  id="btn-execute-query"
                  type="submit"
                  className="flex-1 flex items-center justify-center space-x-2 bg-[#141414] hover:bg-[#2A2A2A] text-[#E4E3E0] font-medium text-xs py-2.5 px-4 border border-[#141414] transition-all font-mono active:translate-y-0.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Send gRPC {command} Request</span>
                </button>
              </div>
            </form>

            {/* Quick Test Presets */}
            <div className="mt-6 pt-4 border-t border-[#141414]">
              <span className="text-[11px] font-bold text-[#605F5B] uppercase tracking-wider block mb-2 font-mono">
                Sample Test Records
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => loadSample('PUT', 'user:1001', '{"name":"Alice","role":"Admin","tier":"Enterprise"}')}
                  className="px-2.5 py-1 text-xs font-mono bg-[#F4F3F0] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] border border-[#141414] transition-all"
                >
                  PUT user:1001 (S0)
                </button>
                <button
                  onClick={() => loadSample('PUT', 'user:1002', '{"name":"Bob","role":"Architect","tier":"Enterprise"}')}
                  className="px-2.5 py-1 text-xs font-mono bg-[#F4F3F0] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] border border-[#141414] transition-all"
                >
                  PUT user:1002 (S1)
                </button>
                <button
                  onClick={() => loadSample('GET', 'user:1001')}
                  className="px-2.5 py-1 text-xs font-mono bg-[#F4F3F0] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] border border-[#141414] transition-all"
                >
                  GET user:1001
                </button>
                <button
                  onClick={() => loadSample('DELETE', 'user:1003')}
                  className="px-2.5 py-1 text-xs font-mono bg-[#F4F3F0] hover:bg-[#590D22] hover:text-[#FFFFFF] text-[#590D22] border border-[#590D22] transition-all"
                >
                  DELETE user:1003
                </button>
              </div>
            </div>
          </div>

          {/* Query History Log */}
          <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3 border-b border-[#141414] pb-2">
              <h3 className="text-xs font-bold text-[#141414] uppercase tracking-wider font-mono">Execution History</h3>
              <span className="text-xs text-[#605F5B] font-mono">{queryHistory.length} requests</span>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {queryHistory.length === 0 ? (
                <div className="text-xs text-[#605F5B] text-center py-6 font-mono">No queries executed yet.</div>
              ) : (
                queryHistory.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => setActiveResult(q)}
                    className={`w-full text-left p-2.5 border transition-all flex items-center justify-between font-mono text-xs ${
                      activeResult?.id === q.id
                        ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                        : 'bg-[#F4F3F0] border-[#141414]/30 text-[#141414] hover:border-[#141414]'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span
                        className={`font-bold px-1.5 py-0.2 text-[10px] border ${
                          activeResult?.id === q.id
                            ? 'bg-[#2A2A2A] text-[#E4E3E0] border-[#505050]'
                            : q.command === 'PUT'
                            ? 'bg-[#E2ECE9] text-[#0F382A] border-[#0F382A]'
                            : q.command === 'GET'
                            ? 'bg-[#E7ECF3] text-[#1E3A8A] border-[#1E3A8A]'
                            : 'bg-[#FCE8E6] text-[#7A1D1D] border-[#7A1D1D]'
                        }`}
                      >
                        {q.command}
                      </span>
                      <span className="font-semibold">{q.key}</span>
                      <span className={`text-[11px] ${activeResult?.id === q.id ? 'text-[#A0A0A0]' : 'text-[#605F5B]'}`}>
                        (S{q.shardIndex} &rarr; {q.targetNodeId})
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className={activeResult?.id === q.id ? 'text-[#C0BFBC]' : 'text-[#605F5B]'}>{q.latencyMs}ms</span>
                      {q.success ? (
                        <CheckCircle2 className={`w-3.5 h-3.5 ${activeResult?.id === q.id ? 'text-[#6EE7B7]' : 'text-[#0F382A]'}`} />
                      ) : (
                        <AlertCircle className={`w-3.5 h-3.5 ${activeResult?.id === q.id ? 'text-[#FCA5A5]' : 'text-[#7A1D1D]'}`} />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Linearizable Execution Trace */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm h-full flex flex-col">
            <div className="flex items-center justify-between mb-4 border-b border-[#141414] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[#141414] flex items-center space-x-2 font-mono">
                  <Shield className="w-4 h-4 text-[#141414]" />
                  <span>Linearizable Execution Trace</span>
                </h3>
                <p className="text-xs text-[#605F5B] mt-0.5 font-serif-italic">
                  Consensus replication & LSM storage engine lifecycle
                </p>
              </div>
              {activeResult && (
                <span className="text-xs font-mono px-2.5 py-1 bg-[#F4F3F0] border border-[#141414] text-[#141414] font-bold">
                  {activeResult.latencyMs} ms
                </span>
              )}
            </div>

            {activeResult ? (
              <div className="space-y-4 flex-1">
                {/* Result Header */}
                <div
                  className={`p-3.5 border flex items-center justify-between font-mono text-xs ${
                    activeResult.success
                      ? 'bg-[#E2ECE9] border-[#0F382A] text-[#0F382A]'
                      : 'bg-[#FCE8E6] border-[#7A1D1D] text-[#7A1D1D]'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    {activeResult.success ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-[#0F382A]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-[#7A1D1D]" />
                    )}
                    <span className="font-bold">
                      {activeResult.success ? 'Status: 200 OK' : 'Status: RPC Error'}
                    </span>
                    {activeResult.found !== undefined && (
                      <span className="font-normal">
                        ({activeResult.found ? 'Key Found' : 'Key Not Found / 404'})
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono">
                    Shard {activeResult.shardIndex} &bull; Leader {activeResult.leaderId}
                  </span>
                </div>

                {/* Returned Value Payload */}
                {activeResult.value && (
                  <div>
                    <label className="block text-xs font-mono font-bold text-[#605F5B] uppercase mb-1">
                      Response Data Payload:
                    </label>
                    <pre className="bg-[#FFFFFF] p-3 border border-[#141414] text-xs font-mono text-[#141414] overflow-x-auto max-h-36">
                      {activeResult.value}
                    </pre>
                  </div>
                )}

                {/* Steps Timeline */}
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-bold text-[#141414] uppercase tracking-wider block font-mono border-b border-[#141414] pb-1">
                    Protocol Stages
                  </span>
                  {activeResult.steps.map((step) => (
                    <div
                      key={step.stepNumber}
                      className="flex items-start space-x-3 p-2.5 bg-[#F4F3F0] border border-[#141414]/40 text-xs font-mono"
                    >
                      <div
                        className={`w-5 h-5 flex items-center justify-center shrink-0 text-[11px] font-bold border ${
                          step.status === 'success'
                            ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                            : step.status === 'warning'
                            ? 'bg-[#7A4B10] text-[#FFFFFF] border-[#7A4B10]'
                            : 'bg-[#7A1D1D] text-[#FFFFFF] border-[#7A1D1D]'
                        }`}
                      >
                        {step.stepNumber}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-[#141414]">{step.title}</div>
                        <div className="text-[#605F5B] text-[11px] mt-0.5 leading-relaxed">
                          {step.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[#605F5B] font-mono">
                <FileCode className="w-10 h-10 mb-3 text-[#A09F9B]" />
                <p className="text-sm font-bold text-[#141414]">No Query Selected</p>
                <p className="text-xs mt-1">Execute a PUT or GET request above to inspect the linearizable consensus trace.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
