import React from 'react';
import { Activity, Cpu, HardDrive, BarChart3, Clock, Zap, ShieldAlert, ArrowUpRight } from 'lucide-react';
import { ClusterMetrics, ShardState } from '../types/infocrate';

interface MetricsDashboardProps {
  metrics: ClusterMetrics;
  shards: ShardState[];
}

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ metrics, shards }) => {
  const totalNodes = shards.reduce((acc, s) => acc + s.nodes.length, 0);
  const totalLogEntries = shards.reduce(
    (acc, s) => acc + s.nodes.reduce((nAcc, n) => nAcc + n.log.length, 0),
    0
  );
  const totalMemtableKeys = shards.reduce(
    (acc, s) => acc + s.nodes.reduce((nAcc, n) => nAcc + n.memtable.length, 0),
    0
  );
  const totalSSTables = shards.reduce(
    (acc, s) =>
      acc +
      s.nodes.reduce((nAcc, n) => nAcc + n.sstablesL0.length + n.sstablesL1.length, 0),
    0
  );

  const bloomFPRate =
    metrics.bloomChecks > 0
      ? (((metrics.bloomChecks - metrics.bloomHits) / metrics.bloomChecks) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[#141414] flex items-center space-x-2 font-mono">
              <Activity className="w-5 h-5 text-[#141414]" />
              <span>Prometheus Telemetry & Observability</span>
            </h2>
            <p className="text-xs text-[#605F5B] mt-0.5 font-serif-italic">
              Real-time metrics scraped from HTTP :9091-:9096 /metrics endpoints across all {totalNodes} Raft nodes.
            </p>
          </div>
          <div className="flex items-center space-x-2 text-xs font-mono">
            <span className="px-3 py-1 bg-[#E2ECE9] border border-[#0F382A] text-[#0F382A] font-bold">
              SCRAPE INTERVAL: 1.0s
            </span>
          </div>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 bg-[#EBEAE6] border border-[#141414] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase text-[#605F5B]">Total Writes (PUT/DEL)</span>
            <Zap className="w-4 h-4 text-[#141414]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2 font-mono">
            <span className="text-2xl font-bold text-[#141414]">{metrics.totalWrites + metrics.totalDeletes}</span>
            <span className="text-xs text-[#605F5B] font-bold">ops</span>
          </div>
          <div className="mt-1 text-[11px] text-[#605F5B] font-mono">
            PUT: {metrics.totalWrites} &bull; DEL: {metrics.totalDeletes}
          </div>
        </div>

        <div className="p-5 bg-[#EBEAE6] border border-[#141414] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase text-[#605F5B]">Total Reads (GET)</span>
            <BarChart3 className="w-4 h-4 text-[#0F382A]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2 font-mono">
            <span className="text-2xl font-bold text-[#141414]">{metrics.totalReads}</span>
            <span className="text-xs text-[#0F382A] font-bold">queries</span>
          </div>
          <div className="mt-1 text-[11px] text-[#605F5B] font-mono">
            LSM Hit Rate: 100%
          </div>
        </div>

        <div className="p-5 bg-[#EBEAE6] border border-[#141414] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase text-[#605F5B]">Commit Latency (P99)</span>
            <Clock className="w-4 h-4 text-[#7A4B10]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2 font-mono">
            <span className="text-2xl font-bold text-[#141414]">{metrics.p99LatencyMs}</span>
            <span className="text-xs text-[#7A4B10] font-bold">ms</span>
          </div>
          <div className="mt-1 text-[11px] text-[#605F5B] font-mono">
            Avg: {metrics.avgLatencyMs} ms
          </div>
        </div>

        <div className="p-5 bg-[#EBEAE6] border border-[#141414] shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-bold uppercase text-[#605F5B]">Bloom Avoided Seeks</span>
            <HardDrive className="w-4 h-4 text-[#1E3A8A]" />
          </div>
          <div className="mt-3 flex items-baseline space-x-2 font-mono">
            <span className="text-2xl font-bold text-[#141414]">{metrics.bloomChecks}</span>
            <span className="text-xs text-[#1E3A8A] font-bold">checks</span>
          </div>
          <div className="mt-1 text-[11px] text-[#605F5B] font-mono">
            Hits: {metrics.bloomHits} &bull; FP Rate: {bloomFPRate}%
          </div>
        </div>
      </div>

      {/* PromQL Metrics Table */}
      <div className="bg-[#EBEAE6] border border-[#141414] p-6 shadow-sm space-y-4">
        <div className="border-b border-[#141414] pb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-[#141414] font-mono uppercase tracking-wider">
            Prometheus Metric Collectors Registry
          </h3>
          <span className="text-xs text-[#605F5B] font-mono">Format: OpenMetrics / Prometheus Text 0.0.4</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse border border-[#141414]">
            <thead>
              <tr className="bg-[#DCDAD5] text-[#141414] border-b border-[#141414]">
                <th className="p-2.5 border-r border-[#141414]">Metric Name</th>
                <th className="p-2.5 border-r border-[#141414]">Type</th>
                <th className="p-2.5 border-r border-[#141414]">Current Value</th>
                <th className="p-2.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/30 bg-[#F4F3F0]">
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_writes_total</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Counter</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{metrics.totalWrites + metrics.totalDeletes}</td>
                <td className="p-2.5 text-[#605F5B]">Total PUT & DELETE operations replicated.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_reads_total</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Counter</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{metrics.totalReads}</td>
                <td className="p-2.5 text-[#605F5B]">Total GET requests processed.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_write_latency_seconds</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Histogram</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{(metrics.avgLatencyMs / 1000).toFixed(4)}s</td>
                <td className="p-2.5 text-[#605F5B]">Write latency from proposal to WAL fsync.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_raft_commit_index</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Gauge</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{totalLogEntries}</td>
                <td className="p-2.5 text-[#605F5B]">Highest committed Raft log entry across nodes.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_lsm_memtable_entries</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Gauge</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{totalMemtableKeys}</td>
                <td className="p-2.5 text-[#605F5B]">Items active in Skip List memtables.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_lsm_sstable_count</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">GaugeVec</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{totalSSTables}</td>
                <td className="p-2.5 text-[#605F5B]">Active SSTable files across Level 0 and Level 1.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_bloom_filter_checks_total</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Counter</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{metrics.bloomChecks}</td>
                <td className="p-2.5 text-[#605F5B]">Total Bloom filter evaluations.</td>
              </tr>
              <tr className="hover:bg-[#EAE9E4]">
                <td className="p-2.5 font-bold text-[#141414] border-r border-[#141414]/30">infocrate_compaction_duration_seconds</td>
                <td className="p-2.5 text-[#605F5B] border-r border-[#141414]/30">Histogram</td>
                <td className="p-2.5 text-[#141414] font-bold border-r border-[#141414]/30">{metrics.compactions} runs</td>
                <td className="p-2.5 text-[#605F5B]">Runtime count of completed L0 &rarr; L1 compactions.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
