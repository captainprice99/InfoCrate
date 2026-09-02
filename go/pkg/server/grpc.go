package server

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/infocrate/infocrate/pkg/lsm"
	"github.com/infocrate/infocrate/pkg/metrics"
	"github.com/infocrate/infocrate/pkg/raft"
	"google.golang.org/grpc"
)

// Server implements the InfoCrate gRPC services.
type Server struct {
	nodeID   string
	shardID  string
	raftNode *raft.Node
	storage  *lsm.Engine
	metrics  *metrics.Metrics
	grpcSrv  *grpc.Server
}

// NewServer initializes a new InfoCrate server instance.
func NewServer(
	nodeID string,
	shardID string,
	raftNode *raft.Node,
	storage *lsm.Engine,
	m *metrics.Metrics,
) *Server {
	return &Server{
		nodeID:   nodeID,
		shardID:  shardID,
		raftNode: raftNode,
		storage:  storage,
		metrics:  m,
	}
}

// Start binds to the given TCP address and serves gRPC requests.
func (s *Server) Start(addr string) error {
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", addr, err)
	}

	s.grpcSrv = grpc.NewServer()
	// Note: In a complete generated environment, protobuf services register here:
	// pb.RegisterInfoCrateServer(s.grpcSrv, s)
	// pb.RegisterRaftConsensusServer(s.grpcSrv, s)

	return s.grpcSrv.Serve(lis)
}

// Stop gracefully shuts down the gRPC server.
func (s *Server) Stop() {
	if s.grpcSrv != nil {
		s.grpcSrv.GracefulStop()
	}
}

// HandlePut processes a client PUT request with linearizable Raft consensus.
func (s *Server) HandlePut(ctx context.Context, key string, val []byte) (bool, string, error) {
	start := time.Now()
	role, _, _, leaderID := s.raftNode.Status()

	if role != raft.RoleLeader {
		return false, leaderID, nil // Redirect client to current leader
	}

	err := s.raftNode.Propose(ctx, "PUT", key, val)
	if err != nil {
		return false, leaderID, err
	}

	if s.metrics != nil {
		s.metrics.WritesTotal.Inc()
		s.metrics.WriteLatency.Observe(time.Since(start).Seconds())
	}

	return true, s.nodeID, nil
}

// HandleGet processes a client GET request.
func (s *Server) HandleGet(ctx context.Context, key string) ([]byte, bool, string, error) {
	start := time.Now()
	role, _, _, leaderID := s.raftNode.Status()

	if role != raft.RoleLeader {
		return nil, false, leaderID, nil
	}

	val, found, err := s.storage.Get(key)
	if err != nil {
		return nil, false, s.nodeID, err
	}

	if s.metrics != nil {
		s.metrics.ReadsTotal.Inc()
		s.metrics.ReadLatency.Observe(time.Since(start).Seconds())
	}

	return val, found, s.nodeID, nil
}

// HandleDelete processes a client DELETE request with linearizable consensus.
func (s *Server) HandleDelete(ctx context.Context, key string) (bool, string, error) {
	start := time.Now()
	role, _, _, leaderID := s.raftNode.Status()

	if role != raft.RoleLeader {
		return false, leaderID, nil
	}

	err := s.raftNode.Propose(ctx, "DELETE", key, nil)
	if err != nil {
		return false, leaderID, err
	}

	if s.metrics != nil {
		s.metrics.WritesTotal.Inc()
		s.metrics.WriteLatency.Observe(time.Since(start).Seconds())
	}

	return true, s.nodeID, nil
}
