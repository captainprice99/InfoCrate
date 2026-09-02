package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds Prometheus metric collectors for InfoCrate.
type Metrics struct {
	WritesTotal        prometheus.Counter
	ReadsTotal         prometheus.Counter
	WriteLatency       prometheus.Histogram
	ReadLatency        prometheus.Histogram
	RaftTerm           prometheus.Gauge
	RaftCommitIndex    prometheus.Gauge
	MemtableSizeBytes  prometheus.Gauge
	MemtableEntryCount prometheus.Gauge
	SSTableCount       *prometheus.GaugeVec
	BloomChecksTotal   prometheus.Counter
	BloomHitsTotal     prometheus.Counter
	CompactionDuration prometheus.Histogram
}

// NewMetrics initializes and registers InfoCrate Prometheus telemetry.
func NewMetrics(nodeID string) *Metrics {
	m := &Metrics{
		WritesTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name:        "infocrate_writes_total",
			Help:        "Total number of write (PUT/DELETE) requests processed.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		ReadsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name:        "infocrate_reads_total",
			Help:        "Total number of read (GET) requests processed.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		WriteLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:        "infocrate_write_latency_seconds",
			Help:        "Write latency from client proposal to Raft quorum commit and LSM apply.",
			ConstLabels: prometheus.Labels{"node": nodeID},
			Buckets:     prometheus.DefBuckets,
		}),
		ReadLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:        "infocrate_read_latency_seconds",
			Help:        "Read latency across Memtable, Bloom Filter, and SSTables.",
			ConstLabels: prometheus.Labels{"node": nodeID},
			Buckets:     prometheus.DefBuckets,
		}),
		RaftTerm: prometheus.NewGauge(prometheus.GaugeOpts{
			Name:        "infocrate_raft_current_term",
			Help:        "Current active Raft term.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		RaftCommitIndex: prometheus.NewGauge(prometheus.GaugeOpts{
			Name:        "infocrate_raft_commit_index",
			Help:        "Highest committed Raft log entry index.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		MemtableSizeBytes: prometheus.NewGauge(prometheus.GaugeOpts{
			Name:        "infocrate_lsm_memtable_bytes",
			Help:        "Current in-memory footprint of active Memtable in bytes.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		MemtableEntryCount: prometheus.NewGauge(prometheus.GaugeOpts{
			Name:        "infocrate_lsm_memtable_entries",
			Help:        "Number of items in active Memtable.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		SSTableCount: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name:        "infocrate_lsm_sstable_count",
			Help:        "Count of active SSTable files by level.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}, []string{"level"}),
		BloomChecksTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name:        "infocrate_bloom_filter_checks_total",
			Help:        "Total number of Bloom filter queries.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		BloomHitsTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name:        "infocrate_bloom_filter_hits_total",
			Help:        "Total number of positive Bloom filter matches.",
			ConstLabels: prometheus.Labels{"node": nodeID},
		}),
		CompactionDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:        "infocrate_compaction_duration_seconds",
			Help:        "Duration of background SSTable compaction merges.",
			ConstLabels: prometheus.Labels{"node": nodeID},
			Buckets:     []float64{0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10},
		}),
	}

	prometheus.MustRegister(
		m.WritesTotal,
		m.ReadsTotal,
		m.WriteLatency,
		m.ReadLatency,
		m.RaftTerm,
		m.RaftCommitIndex,
		m.MemtableSizeBytes,
		m.MemtableEntryCount,
		m.SSTableCount,
		m.BloomChecksTotal,
		m.BloomHitsTotal,
		m.CompactionDuration,
	)

	return m
}

// StartMetricsServer starts an HTTP listener exposing the Prometheus `/metrics` endpoint.
func StartMetricsServer(addr string) error {
	http.Handle("/metrics", promhttp.Handler())
	return http.ListenAndServe(addr, nil)
}
