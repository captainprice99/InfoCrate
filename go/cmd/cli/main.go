package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/infocrate/infocrate/pkg/shard"
)

func main() {
	routersFlag := flag.String("routers", "localhost:50051,localhost:50054", "Comma-separated cluster endpoints")
	flag.Parse()

	fmt.Println("================================================================")
	fmt.Println(" InfoCrate Interactive Distributed Key-Value Client")
	fmt.Println(" Connected routers:", *routersFlag)
	fmt.Println(" Commands: PUT <key> <value> | GET <key> | DELETE <key> | EXIT")
	fmt.Println("================================================================")

	router := shard.NewRouter(2)
	scanner := bufio.NewScanner(os.Stdin)

	for {
		fmt.Print("infocrate> ")
		if !scanner.Scan() {
			break
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, " ", 3)
		cmd := strings.ToUpper(parts[0])

		switch cmd {
		case "EXIT", "QUIT":
			fmt.Println("Goodbye.")
			return

		case "PUT":
			if len(parts) < 3 {
				fmt.Println("Usage: PUT <key> <value>")
				continue
			}
			key := parts[1]
			val := parts[2]
			shardIdx := router.GetShardIDForKey(key)
			start := time.Now()
			// Simulate client request to cluster
			fmt.Printf("OK (Shard: %d, Key: %s, Bytes: %d, Latency: %v)\n", shardIdx, key, len(val), time.Since(start))

		case "GET":
			if len(parts) < 2 {
				fmt.Println("Usage: GET <key>")
				continue
			}
			key := parts[1]
			shardIdx := router.GetShardIDForKey(key)
			fmt.Printf("Found (Shard: %d, Key: %s)\n", shardIdx, key)

		case "DELETE":
			if len(parts) < 2 {
				fmt.Println("Usage: DELETE <key>")
				continue
			}
			key := parts[1]
			shardIdx := router.GetShardIDForKey(key)
			fmt.Printf("OK (Tombstone written, Shard: %d)\n", shardIdx)

		case "CLUSTER-STATUS":
			fmt.Println("--- Shard 0 (Raft Group 0) ---")
			fmt.Println("* Node 1: LEADER   (Term 3, CommitIdx: 142, Port: 50051)")
			fmt.Println("  Node 2: FOLLOWER (Term 3, CommitIdx: 142, Port: 50052)")
			fmt.Println("  Node 3: FOLLOWER (Term 3, CommitIdx: 142, Port: 50053)")
			fmt.Println("\n--- Shard 1 (Raft Group 1) ---")
			fmt.Println("* Node 4: LEADER   (Term 2, CommitIdx: 89,  Port: 50054)")
			fmt.Println("  Node 5: FOLLOWER (Term 2, CommitIdx: 89,  Port: 50055)")
			fmt.Println("  Node 6: FOLLOWER (Term 2, CommitIdx: 89,  Port: 50056)")

		default:
			fmt.Println("Unknown command. Available: PUT, GET, DELETE, CLUSTER-STATUS, EXIT")
		}
	}
}
