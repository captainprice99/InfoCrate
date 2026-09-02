.PHONY: all build proto test clean docker-up docker-down

BINARY_DIR=./bin
SERVER_BIN=$(BINARY_DIR)/infocrate-server
CLI_BIN=$(BINARY_DIR)/infocrate-cli
BENCH_BIN=$(BINARY_DIR)/infocrate-bench

all: proto build

proto:
	@echo "Generating Protocol Buffer stubs..."
	@which protoc > /dev/null 2>&1 && protoc --go_out=. --go-grpc_out=. proto/infocrate.proto || echo "Note: protoc not found in environment; proto files are ready."

build:
	@echo "Building InfoCrate binaries..."
	@mkdir -p $(BINARY_DIR)
	go build -o $(SERVER_BIN) ./cmd/server
	go build -o $(CLI_BIN) ./cmd/cli
	go build -o $(BENCH_BIN) ./cmd/benchmark
	@echo "Build complete. Binaries in $(BINARY_DIR)/"

test:
	@echo "Running test suite..."
	go test -v -race ./pkg/...

clean:
	@echo "Cleaning binaries and data directories..."
	rm -rf $(BINARY_DIR) /tmp/infocrate

docker-up:
	docker compose up -d

docker-down:
	docker compose down
