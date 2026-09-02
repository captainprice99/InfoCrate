package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/infocrate/infocrate/pkg/lsm"
	"github.com/infocrate/infocrate/pkg/metrics"
	"github.com/infocrate/infocrate/pkg/raft"
	"github.com/infocrate/infocrate/pkg/server"
)

func main() {
	nodeID := flag.String("node-id", "node-1", "Unique identifier for this node")
	shardID := flag.String("shard-id", "shard-0", "Shard group identifier")
	grpcPort := flag.Int("grpc-port", 50051, "gRPC port for client and Raft consensus")
	metricsPort := flag.Int("metrics-port", 9091, "Prometheus metrics HTTP port")
	dataDir := flag.String("data-dir", "/tmp/infocrate/data", "Directory for WAL and SSTable storage")
	peersFlag := flag.String("peers", "", "Comma-separated peer node IDs or addresses")
	flag.Parse()

	log.Printf("[InfoCrate] Starting node %s on shard %s...", *nodeID, *shardID)

	var peers []string
	if *peersFlag != "" {
		peers = strings.Split(*peersFlag, ",")
	}

	// 1. Initialize LSM-Tree Storage Engine
	opts := lsm.EngineOptions{
		DataDir:            *dataDir,
		MemtableLimitBytes: 16 * 1024 * 1024, // 16MB
		L0CompactionLimit:  4,
	}
	storage, err := lsm.OpenEngine(opts)
	if err != nil {
		log.Fatalf("Failed to open LSM engine: %v", err)
	}
	defer storage.Close()

	// 2. Initialize Prometheus Telemetry
	telemetry := metrics.NewMetrics(*nodeID)
	go func() {
		addr := fmt.Sprintf(":%d", *metricsPort)
		log.Printf("[InfoCrate] Metrics available on http://0.0.0.0:%d/metrics", *metricsPort)
		if err := metrics.StartMetricsServer(addr); err != nil {
			log.Printf("Metrics server error: %v", err)
		}
	}()

	// 3. Initialize Raft Consensus Node
	raftCfg := raft.Config{
		NodeID:  *nodeID,
		ShardID: *shardID,
		Peers:   peers,
	}
	raftNode := raft.NewNode(raftCfg, storage)
	raftNode.Start()
	defer raftNode.Stop()

	// 4. Initialize and start gRPC Server
	srv := server.NewServer(*nodeID, *shardID, raftNode, storage, telemetry)
	grpcAddr := fmt.Sprintf("0.0.0.0:%d", *grpcPort)
	go func() {
		log.Printf("[InfoCrate] gRPC server listening on %s", grpcAddr)
		if err := srv.Start(grpcAddr); err != nil {
			log.Printf("gRPC server terminated: %v", err)
		}
	}()

	// Graceful shutdown on signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	<-sigCh

	log.Println("[InfoCrate] Shutting down node gracefully...")
	srv.Stop()
}
