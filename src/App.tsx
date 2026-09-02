import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { QueryConsole } from './components/QueryConsole';
import { ClusterTopology } from './components/ClusterTopology';
import { LsmInspector } from './components/LsmInspector';
import { MetricsDashboard } from './components/MetricsDashboard';
import { ChaosLab } from './components/ChaosLab';
import { CodeExplorer } from './components/CodeExplorer';
import { clusterInstance } from './engine/clusterSimulator';
import { ShardState, ClusterMetrics, QueryResult } from './types/infocrate';

export default function App() {
  const [activeTab, setActiveTab] = useState<'console' | 'cluster' | 'lsm' | 'metrics' | 'chaos' | 'code'>('console');
  const [shards, setShards] = useState<ShardState[]>(clusterInstance.getShards());
  const [metrics, setMetrics] = useState<ClusterMetrics>(clusterInstance.getMetrics());
  const [queryHistory, setQueryHistory] = useState<QueryResult[]>(clusterInstance.getQueryHistory());

  useEffect(() => {
    const unsubscribe = clusterInstance.subscribe(() => {
      setShards([...clusterInstance.getShards()]);
      setMetrics({ ...clusterInstance.getMetrics() });
      setQueryHistory([...clusterInstance.getQueryHistory()]);
    });
    return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex flex-col font-sans antialiased selection:bg-[#141414] selection:text-[#E4E3E0]">
      <Header shards={shards} activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'console' && (
          <QueryConsole shards={shards} queryHistory={queryHistory} />
        )}

        {activeTab === 'cluster' && (
          <ClusterTopology shards={shards} />
        )}

        {activeTab === 'lsm' && (
          <LsmInspector shards={shards} />
        )}

        {activeTab === 'metrics' && (
          <MetricsDashboard metrics={metrics} shards={shards} />
        )}

        {activeTab === 'chaos' && (
          <ChaosLab shards={shards} />
        )}

        {activeTab === 'code' && (
          <CodeExplorer />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#141414] bg-[#DCDAD5] py-4 text-center text-xs font-mono text-[#5A5956]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <span className="font-bold text-[#141414]">InfoCrate</span>
            <span>&bull; Distributed Consensus & LSM Database Engine</span>
            <span>&bull; Strict Linearizability</span>
          </div>
          <div className="text-[#6E6D68]">
            Go 1.21+ &bull; gRPC Proto3 &bull; Prometheus Telemetry
          </div>
        </div>
      </footer>
    </div>
  );
}
