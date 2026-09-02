package lsm

import (
	"fmt"
	"os"
	"sort"
	"sync"
	"time"
)

// CompactionTask represents a background merge operation from level L to L+1.
type CompactionTask struct {
	SourceLevel int
	TargetLevel int
	Tables      []*SSTableReader
}

// Compactor handles background multi-way merge sorts and tombstone elimination.
type Compactor struct {
	mu           sync.Mutex
	dataDir      string
	l0Threshold  int
	isCompacting bool
}

// NewCompactor creates a new compactor instance.
func NewCompactor(dataDir string, l0Threshold int) *Compactor {
	if l0Threshold <= 0 {
		l0Threshold = 4
	}
	return &Compactor{
		dataDir:     dataDir,
		l0Threshold: l0Threshold,
	}
}

// MergeSSTables performs a k-way merge of input SSTables, discarding dead tombstones.
// isBottomLevel indicates if this is the deepest level (where tombstones can be safely discarded).
func (c *Compactor) MergeSSTables(
	sourceTables []*SSTableReader,
	outputPath string,
	isBottomLevel bool,
) (*SSTableMetadata, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// 1. Gather all entries from input SSTables
	var allEntries []Entry
	for _, reader := range sourceTables {
		entries, err := reader.ScanAll()
		if err != nil {
			return nil, fmt.Errorf("failed to scan sstable %s: %w", reader.meta.Path, err)
		}
		allEntries = append(allEntries, entries...)
	}

	if len(allEntries) == 0 {
		return nil, nil
	}

	// 2. Sort all entries by Key ascending, then by Timestamp descending
	sort.SliceStable(allEntries, func(i, j int) bool {
		if allEntries[i].Key == allEntries[j].Key {
			return allEntries[i].Timestamp > allEntries[j].Timestamp
		}
		return allEntries[i].Key < allEntries[j].Key
	})

	// 3. Deduplicate: retain only the latest timestamp per key
	var mergedEntries []Entry
	var lastKey string
	var hasLastKey bool

	for _, entry := range allEntries {
		if hasLastKey && entry.Key == lastKey {
			// Older version of the same key: discard
			continue
		}
		lastKey = entry.Key
		hasLastKey = true

		// If tombstone and at the bottom-most level, discard completely
		if entry.IsTombstone && isBottomLevel {
			continue
		}

		mergedEntries = append(mergedEntries, entry)
	}

	if len(mergedEntries) == 0 {
		return nil, nil
	}

	// 4. Write new merged SSTable
	writer, err := NewSSTableWriter(outputPath, len(mergedEntries))
	if err != nil {
		return nil, fmt.Errorf("failed to create compaction sstable: %w", err)
	}

	for _, entry := range mergedEntries {
		if err := writer.Add(entry.Key, entry.Value, entry.IsTombstone, entry.Timestamp); err != nil {
			return nil, err
		}
	}

	meta, err := writer.Finish()
	if err != nil {
		return nil, fmt.Errorf("failed to finish compacted sstable: %w", err)
	}

	return meta, nil
}

// CleanOldFiles deletes source SSTable files from disk after successful compaction.
func (c *Compactor) CleanOldFiles(tables []*SSTableReader) {
	for _, table := range tables {
		path := table.meta.Path
		table.Close()
		_ = os.Remove(path)
	}
}
