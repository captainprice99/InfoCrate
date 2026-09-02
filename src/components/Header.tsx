import React from 'react';
import { Database, Activity, Server, Layers, ShieldCheck, Terminal, Cpu, Flame, Code } from 'lucide-react';
import { ShardState } from '../types/infocrate';

interface HeaderProps {
  shards: ShardState[];
  activeTab: 'console' | 'cluster' | 'lsm' | 'metrics' | 'chaos' | 'code';
  setActiveTab: (tab: 'console' | 'cluster' | 'lsm' | 'metrics' | 'chaos' | 'code') => void;
}

export const Header: React.FC<HeaderProps> = ({ shards, activeTab, setActiveTab }) => {
  const totalNodes = shards.reduce((acc, s) => acc + s.nodes.length, 0);
  const onlineNodes = shards.reduce(
    (acc, s) => acc + s.nodes.filter((n) => n.isHealthy && !n.isPartitioned).length,
    0
  );
  const activeLeaders = shards.filter((s) => s.leaderId !== null).length;

  return (
    <header id="app-header" className="bg-[#EBEAE6] border-b border-[#141414] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Branding */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 bg-[#141414] border border-[#141414] flex items-center justify-center text-[#E4E3E0] font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-[#141414] font-mono">InfoCrate</span>
                <span className="text-xs px-2 py-0.5 bg-[#DCDAD5] text-[#141414] border border-[#141414] font-mono font-medium">
                  v1.21-Go
                </span>
                <span className="hidden sm:inline-flex items-center space-x-1 text-xs px-2 py-0.5 bg-[#E2ECE9] text-[#0F382A] border border-[#0F382A] font-mono font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0F382A]" />
                  <span>Strict Linearizability</span>
                </span>
              </div>
              <p className="text-xs text-[#605F5B] hidden md:block font-serif-italic">
                Distributed LSM-Tree & Raft Consensus Key-Value Database
              </p>
            </div>
          </div>

          {/* Quick Cluster Status Badges */}
          <div className="hidden lg:flex items-center space-x-3 text-xs font-mono">
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-[#F4F3F0] border border-[#141414] text-[#141414]">
              <Layers className="w-3.5 h-3.5 text-[#141414]" />
              <span className="text-[#605F5B]">SHARDS:</span>
              <span className="font-bold">{shards.length}</span>
            </div>
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-[#F4F3F0] border border-[#141414] text-[#141414]">
              <Server className="w-3.5 h-3.5 text-[#0F382A]" />
              <span className="text-[#605F5B]">NODES:</span>
              <span className="font-bold">{onlineNodes}/{totalNodes}</span>
            </div>
            <div className="flex items-center space-x-1.5 px-3 py-1 bg-[#F4F3F0] border border-[#141414] text-[#141414]">
              <Activity className="w-3.5 h-3.5 text-[#7A4B10]" />
              <span className="text-[#605F5B]">LEADERS:</span>
              <span className="font-bold">{activeLeaders}/{shards.length}</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-2 border-t border-[#141414] scrollbar-none text-xs font-mono">
          <button
            id="tab-query-console"
            onClick={() => setActiveTab('console')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'console'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>1. Query Console</span>
          </button>

          <button
            id="tab-cluster-topology"
            onClick={() => setActiveTab('cluster')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'cluster'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>2. Cluster Topology & Raft</span>
          </button>

          <button
            id="tab-lsm-inspector"
            onClick={() => setActiveTab('lsm')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'lsm'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>3. LSM Storage Inspector</span>
          </button>

          <button
            id="tab-metrics"
            onClick={() => setActiveTab('metrics')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'metrics'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>4. Prometheus Telemetry</span>
          </button>

          <button
            id="tab-chaos-lab"
            onClick={() => setActiveTab('chaos')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'chaos'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>5. Chaos & Workloads</span>
          </button>

          <button
            id="tab-code-explorer"
            onClick={() => setActiveTab('code')}
            className={`flex items-center space-x-2 px-3 py-1.5 border transition-all whitespace-nowrap font-medium ${
              activeTab === 'code'
                ? 'bg-[#141414] text-[#E4E3E0] border-[#141414]'
                : 'bg-[#F4F3F0] text-[#141414] border-[#141414]/40 hover:border-[#141414] hover:bg-[#DCDAD5]'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>6. Go Source & Proto</span>
          </button>
        </div>
      </div>
    </header>
  );
};
