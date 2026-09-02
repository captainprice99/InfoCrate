package lsm

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// EngineOptions defines configuration parameters for the LSM engine.
type EngineOptions struct {
	DataDir            string
	MemtableLimitBytes int64
	L0CompactionLimit  int
}

// LSMStats holds runtime storage engine metrics.
type LSMStats struct {
	MemtableSizeBytes   int64
	MemtableEntryCount  int
	ImmutableCount      int
	L0TableCount        int
	L1TableCount        int
	TotalDiskBytes      int64
	BloomFilterChecks   int64
	BloomFilterHits     int64
	BloomFilterFPRate   float64
	CompactionCount     int64
}

// Engine coordinates the WAL, Memtable, Immutable Memtables, SSTables, and background compaction.
type Engine struct {
	mu           sync.RWMutex
	opts         EngineOptions
	wal          *WAL
	memtable     *Memtable
	immutable    []*Memtable
	l0Tables     []*SSTableReader
	l1Tables     []*SSTableReader
	compactor    *Compactor
	nextSSTableID uint64
	flushChan    chan *Memtable
	stopChan     chan struct{}
	wg           sync.WaitGroup

	// Metrics
	bloomChecks  int64
	bloomHits    int64
	compactions  int64
}

// OpenEngine initializes or recovers an LSM-Tree storage engine at the specified data directory.
func OpenEngine(opts EngineOptions) (*Engine, error) {
	if opts.MemtableLimitBytes <= 0 {
		opts.MemtableLimitBytes = 16 * 1024 * 1024 // 16MB default
	}
	if opts.L0CompactionLimit <= 0 {
		opts.L0CompactionLimit = 4
	}

	if err := os.MkdirAll(opts.DataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data dir: %w", err)
	}

	walPath := filepath.Join(opts.DataDir, "wal.log")
	wal, err := OpenWAL(walPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open wal: %w", err)
	}

	engine := &Engine{
		opts:       opts,
		wal:        wal,
		memtable:   NewMemtable(),
		immutable:  make([]*Memtable, 0),
		l0Tables:   make([]*SSTableReader, 0),
		l1Tables:   make([]*SSTableReader, 0),
		compactor:  NewCompactor(opts.DataDir, opts.L0CompactionLimit),
		flushChan:  make(chan *Memtable, 16),
		stopChan:   make(chan struct{}),
	}

	// 1. Recover state from WAL
	entries, err := wal.Recover()
	if err != nil {
		return nil, fmt.Errorf("wal recovery failed: %w", err)
	}
	for _, entry := range entries {
		if entry.IsTombstone {
			engine.memtable.Delete(entry.Key, entry.Timestamp)
		} else {
			engine.memtable.Put(entry.Key, entry.Value, entry.Timestamp)
		}
	}

	// 2. Discover existing SSTables in data directory
	if err := engine.loadExistingSSTables(); err != nil {
		return nil, fmt.Errorf("failed to load sstables: %w", err)
	}

	// 3. Start background flush & compaction workers
	engine.wg.Add(1)
	go engine.flushWorker()

	return engine, nil
}

// loadExistingSSTables scans dataDir for existing .sst files.
func (e *Engine) loadExistingSSTables() error {
	files, err := os.ReadDir(e.opts.DataDir)
	if err != nil {
		return err
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".sst" {
			path := filepath.Join(e.opts.DataDir, file.Name())
			id := atomic.AddUint64(&e.nextSSTableID, 1)
			reader, err := OpenSSTableReader(path, id, 0)
			if err != nil {
				continue
			}
			e.l0Tables = append(e.l0Tables, reader)
		}
	}
	return nil
}

// Put writes a key-value record to the WAL and Memtable.
func (e *Engine) Put(key string, value []byte) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	// 1. Append to WAL and fsync
	walEntry, err := e.wal.Write(key, value, false)
	if err != nil {
		return fmt.Errorf("wal write error: %w", err)
	}

	// 2. Insert into Memtable
	e.memtable.Put(key, value, walEntry.Timestamp)

	// 3. Check if Memtable reached size limit
	if e.memtable.Size() >= e.opts.MemtableLimitBytes {
		e.rotateMemtable()
	}

	return nil
}

// Delete marks a key with a tombstone in WAL and Memtable.
func (e *Engine) Delete(key string) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	walEntry, err := e.wal.Write(key, nil, true)
	if err != nil {
		return fmt.Errorf("wal write error: %w", err)
	}

	e.memtable.Delete(key, walEntry.Timestamp)

	if e.memtable.Size() >= e.opts.MemtableLimitBytes {
		e.rotateMemtable()
	}

	return nil
}

// rotateMemtable moves active memtable to immutable queue and initializes a fresh one.
func (e *Engine) rotateMemtable() {
	imm := e.memtable
	e.immutable = append(e.immutable, imm)
	e.memtable = NewMemtable()

	select {
	case e.flushChan <- imm:
	default:
		// Queue is full; worker is processing
	}
}

// Get performs a multi-level point lookup: Active Memtable -> Immutable Memtables -> L0 SSTables -> L1 SSTables.
func (e *Engine) Get(key string) ([]byte, bool, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	// 1. Search Active Memtable
	if val, isTombstone, found := e.memtable.Get(key); found {
		if isTombstone {
			return nil, false, nil
		}
		return val, true, nil
	}

	// 2. Search Immutable Memtables (newest to oldest)
	for i := len(e.immutable) - 1; i >= 0; i-- {
		if val, isTombstone, found := e.immutable[i].Get(key); found {
			if isTombstone {
				return nil, false, nil
			}
			return val, true, nil
		}
	}

	// 3. Search Level 0 SSTables (newest to oldest)
	for i := len(e.l0Tables) - 1; i >= 0; i-- {
		atomic.AddInt64(&e.bloomChecks, 1)
		val, isTombstone, found, err := e.l0Tables[i].Get(key)
		if err != nil {
			return nil, false, err
		}
		if found {
			atomic.AddInt64(&e.bloomHits, 1)
			if isTombstone {
				return nil, false, nil
			}
			return val, true, nil
		}
	}

	// 4. Search Level 1 SSTables
	for _, table := range e.l1Tables {
		if key < table.meta.MinKey || key > table.meta.MaxKey {
			continue
		}
		atomic.AddInt64(&e.bloomChecks, 1)
		val, isTombstone, found, err := table.Get(key)
		if err != nil {
			return nil, false, err
		}
		if found {
			atomic.AddInt64(&e.bloomHits, 1)
			if isTombstone {
				return nil, false, nil
			}
			return val, true, nil
		}
	}

	return nil, false, nil
}

// flushWorker runs in the background, flushing Immutable Memtables to L0 SSTables.
func (e *Engine) flushWorker() {
	defer e.wg.Done()

	for {
		select {
		case <-e.stopChan:
			return
		case imm := <-e.flushChan:
			e.flushMemtable(imm)
		}
	}
}

// flushMemtable writes an immutable memtable to an L0 SSTable file on disk.
func (e *Engine) flushMemtable(imm *Memtable) {
	entries := imm.AllEntries()
	if len(entries) == 0 {
		return
	}

	id := atomic.AddUint64(&e.nextSSTableID, 1)
	filename := fmt.Sprintf("sstable_L0_%06d.sst", id)
	path := filepath.Join(e.opts.DataDir, filename)

	writer, err := NewSSTableWriter(path, len(entries))
	if err != nil {
		return
	}

	for _, entry := range entries {
		_ = writer.Add(entry.Key, entry.Value, entry.IsTombstone, entry.Timestamp)
	}

	meta, err := writer.Finish()
	if err != nil {
		return
	}

	reader, err := OpenSSTableReader(path, id, 0)
	if err != nil {
		return
	}
	reader.meta = *meta

	e.mu.Lock()
	// Add to L0 tables
	e.l0Tables = append(e.l0Tables, reader)

	// Remove from immutable list
	for i, table := range e.immutable {
		if table == imm {
			e.immutable = append(e.immutable[:i], e.immutable[i+1:]...)
			break
		}
	}

	// Reset WAL if all immutables are flushed
	if len(e.immutable) == 0 {
		_ = e.wal.Reset()
	}

	shouldCompact := len(e.l0Tables) >= e.opts.L0CompactionLimit
	e.mu.Unlock()

	if shouldCompact {
		go e.TriggerCompaction()
	}
}

// TriggerCompaction manually or automatically merges L0 tables into L1.
func (e *Engine) TriggerCompaction() {
	e.mu.Lock()
	if len(e.l0Tables) < 2 {
		e.mu.Unlock()
		return
	}

	tablesToCompact := make([]*SSTableReader, len(e.l0Tables))
	copy(tablesToCompact, e.l0Tables)
	e.mu.Unlock()

	id := atomic.AddUint64(&e.nextSSTableID, 1)
	filename := fmt.Sprintf("sstable_L1_%06d.sst", id)
	outputPath := filepath.Join(e.opts.DataDir, filename)

	meta, err := e.compactor.MergeSSTables(tablesToCompact, outputPath, true)
	if err != nil || meta == nil {
		return
	}

	newReader, err := OpenSSTableReader(outputPath, id, 1)
	if err != nil {
		return
	}
	newReader.meta = *meta

	e.mu.Lock()
	e.l1Tables = append(e.l1Tables, newReader)
	e.l0Tables = nil
	atomic.AddInt64(&e.compactions, 1)
	e.mu.Unlock()

	e.compactor.CleanOldFiles(tablesToCompact)
}

// Stats returns a snapshot of the engine statistics.
func (e *Engine) Stats() LSMStats {
	e.mu.RLock()
	defer e.mu.RUnlock()

	var totalDisk int64
	for _, t := range e.l0Tables {
		totalDisk += t.meta.FileBytes
	}
	for _, t := range e.l1Tables {
		totalDisk += t.meta.FileBytes
	}

	checks := atomic.LoadInt64(&e.bloomChecks)
	hits := atomic.LoadInt64(&e.bloomHits)
	var fpRate float64
	if checks > 0 {
		fpRate = float64(checks-hits) / float64(checks)
	}

	return LSMStats{
		MemtableSizeBytes:  e.memtable.Size(),
		MemtableEntryCount: e.memtable.Count(),
		ImmutableCount:     len(e.immutable),
		L0TableCount:       len(e.l0Tables),
		L1TableCount:       len(e.l1Tables),
		TotalDiskBytes:     totalDisk,
		BloomFilterChecks:  checks,
		BloomFilterHits:    hits,
		BloomFilterFPRate:  fpRate,
		CompactionCount:    atomic.LoadInt64(&e.compactions),
	}
}

// Close gracefully stops workers, flushes memtables, and closes files.
func (e *Engine) Close() error {
	close(e.stopChan)
	e.wg.Wait()

	e.mu.Lock()
	defer e.mu.Unlock()

	if err := e.wal.Close(); err != nil {
		return err
	}
	for _, t := range e.l0Tables {
		_ = t.Close()
	}
	for _, t := range e.l1Tables {
		_ = t.Close()
	}
	return nil
}
