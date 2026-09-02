package lsm

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"sync"
)

const (
	SSTableMagicNumber = uint64(0x494E464F43524154) // "INFOCRAT"
	DefaultBlockSize   = 4096                     // 4KB block target
	FooterSize         = 40                       // 8*5 bytes
)

var (
	ErrInvalidSSTable = errors.New("invalid SSTable: magic number mismatch or corrupt footer")
)

// IndexEntry represents a pointer to a specific data block in the SSTable.
type IndexEntry struct {
	LastKey string
	Offset  uint64
	Length  uint64
}

// SSTableMetadata contains runtime information about an SSTable.
type SSTableMetadata struct {
	ID        uint64
	Level     int
	MinKey    string
	MaxKey    string
	EntryNum  int
	FileBytes int64
	Path      string
}

// SSTableWriter serializes sorted entries to an immutable disk file.
type SSTableWriter struct {
	file         *os.File
	path         string
	blockSize    int
	currBlock    []byte
	indexEntries []IndexEntry
	bloom        *BloomFilter
	minKey       string
	maxKey       string
	entryCount   int
	offset       uint64
}

// NewSSTableWriter initializes a writer for a new SSTable.
func NewSSTableWriter(path string, expectedEntries int) (*SSTableWriter, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to create SSTable file: %w", err)
	}

	return &SSTableWriter{
		file:      file,
		path:      path,
		blockSize: DefaultBlockSize,
		bloom:     NewBloomFilter(expectedEntries, 0.01),
	}, nil
}

// Add appends a key-value entry (must be sorted in strictly ascending key order).
func (w *SSTableWriter) Add(key string, value []byte, isTombstone bool, ts int64) error {
	if w.minKey == "" || key < w.minKey {
		w.minKey = key
	}
	if key > w.maxKey {
		w.maxKey = key
	}

	w.bloom.Add(key)
	w.entryCount++

	// Entry binary encoding:
	// [KeyLen (2B)][ValLen (4B)][Flags (1B)][Timestamp (8B)][Key][Value]
	kBytes := []byte(key)
	vBytes := value
	if isTombstone {
		vBytes = nil
	}

	var flags byte = 0
	if isTombstone {
		flags = 1
	}

	entryBuf := make([]byte, 2+4+1+8+len(kBytes)+len(vBytes))
	binary.LittleEndian.PutUint16(entryBuf[0:2], uint16(len(kBytes)))
	binary.LittleEndian.PutUint32(entryBuf[2:6], uint32(len(vBytes)))
	entryBuf[6] = flags
	binary.LittleEndian.PutUint64(entryBuf[7:15], uint64(ts))
	copy(entryBuf[15:15+len(kBytes)], kBytes)
	if len(vBytes) > 0 {
		copy(entryBuf[15+len(kBytes):], vBytes)
	}

	w.currBlock = append(w.currBlock, entryBuf...)

	// If block threshold exceeded, flush block to disk
	if len(w.currBlock) >= w.blockSize {
		if err := w.flushBlock(key); err != nil {
			return err
		}
	}

	return nil
}

// flushBlock writes the current data block to disk and records an index entry.
func (w *SSTableWriter) flushBlock(lastKey string) error {
	if len(w.currBlock) == 0 {
		return nil
	}

	n, err := w.file.Write(w.currBlock)
	if err != nil {
		return fmt.Errorf("failed to write data block: %w", err)
	}

	w.indexEntries = append(w.indexEntries, IndexEntry{
		LastKey: lastKey,
		Offset:  w.offset,
		Length:  uint64(n),
	})

	w.offset += uint64(n)
	w.currBlock = w.currBlock[:0]
	return nil
}

// Finish flushes remaining data, appends Bloom filter block, index block, and footer.
func (w *SSTableWriter) Finish() (*SSTableMetadata, error) {
	if len(w.currBlock) > 0 {
		if err := w.flushBlock(w.maxKey); err != nil {
			return nil, err
		}
	}

	// 1. Write Bloom Filter block
	filterBytes := w.bloom.Encode()
	filterOffset := w.offset
	filterLength := uint64(len(filterBytes))
	if _, err := w.file.Write(filterBytes); err != nil {
		return nil, fmt.Errorf("failed to write filter block: %w", err)
	}
	w.offset += filterLength

	// 2. Write Index block
	var indexBuf bytes.Buffer
	for _, ie := range w.indexEntries {
		kBytes := []byte(ie.LastKey)
		var entryHeader [2 + 8 + 8]byte
		binary.LittleEndian.PutUint16(entryHeader[0:2], uint16(len(kBytes)))
		binary.LittleEndian.PutUint64(entryHeader[2:10], ie.Offset)
		binary.LittleEndian.PutUint64(entryHeader[10:18], ie.Length)
		indexBuf.Write(entryHeader[:])
		indexBuf.Write(kBytes)
	}

	indexOffset := w.offset
	indexLength := uint64(indexBuf.Len())
	if _, err := w.file.Write(indexBuf.Bytes()); err != nil {
		return nil, fmt.Errorf("failed to write index block: %w", err)
	}
	w.offset += indexLength

	// 3. Write Footer: [FilterOffset (8B)][FilterLength (8B)][IndexOffset (8B)][IndexLength (8B)][MagicNumber (8B)]
	var footer [FooterSize]byte
	binary.LittleEndian.PutUint64(footer[0:8], filterOffset)
	binary.LittleEndian.PutUint64(footer[8:16], filterLength)
	binary.LittleEndian.PutUint64(footer[16:24], indexOffset)
	binary.LittleEndian.PutUint64(footer[24:32], indexLength)
	binary.LittleEndian.PutUint64(footer[32:40], SSTableMagicNumber)

	if _, err := w.file.Write(footer[:]); err != nil {
		return nil, fmt.Errorf("failed to write footer: %w", err)
	}
	w.offset += FooterSize

	if err := w.file.Sync(); err != nil {
		return nil, fmt.Errorf("failed to sync SSTable: %w", err)
	}
	if err := w.file.Close(); err != nil {
		return nil, fmt.Errorf("failed to close SSTable: %w", err)
	}

	return &SSTableMetadata{
		MinKey:    w.minKey,
		MaxKey:    w.maxKey,
		EntryNum:  w.entryCount,
		FileBytes: int64(w.offset),
		Path:      w.path,
	}, nil
}

// SSTableReader provides concurrent read access to an on-disk SSTable.
type SSTableReader struct {
	mu           sync.RWMutex
	file         *os.File
	meta         SSTableMetadata
	bloom        *BloomFilter
	indexEntries []IndexEntry
}

// OpenSSTableReader opens and reads metadata, bloom filter, and sparse index from an SSTable.
func OpenSSTableReader(path string, id uint64, level int) (*SSTableReader, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open SSTable: %w", err)
	}

	stat, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}

	if stat.Size() < FooterSize {
		file.Close()
		return nil, ErrInvalidSSTable
	}

	// Read footer
	footerBuf := make([]byte, FooterSize)
	if _, err := file.ReadAt(footerBuf, stat.Size()-FooterSize); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to read footer: %w", err)
	}

	magic := binary.LittleEndian.Uint64(footerBuf[32:40])
	if magic != SSTableMagicNumber {
		file.Close()
		return nil, ErrInvalidSSTable
	}

	filterOffset := binary.LittleEndian.Uint64(footerBuf[0:8])
	filterLength := binary.LittleEndian.Uint64(footerBuf[8:16])
	indexOffset := binary.LittleEndian.Uint64(footerBuf[16:24])
	indexLength := binary.LittleEndian.Uint64(footerBuf[24:32])

	// Read Bloom Filter block
	filterBytes := make([]byte, filterLength)
	if _, err := file.ReadAt(filterBytes, int64(filterOffset)); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to read bloom filter: %w", err)
	}
	bloom, err := DecodeBloomFilter(filterBytes)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to decode bloom filter: %w", err)
	}

	// Read Index block
	indexBytes := make([]byte, indexLength)
	if _, err := file.ReadAt(indexBytes, int64(indexOffset)); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to read index block: %w", err)
	}

	var indexEntries []IndexEntry
	idxReader := bytes.NewReader(indexBytes)
	for idxReader.Len() > 0 {
		var header [18]byte
		if _, err := io.ReadFull(idxReader, header[:]); err != nil {
			break
		}
		kLen := binary.LittleEndian.Uint16(header[0:2])
		offset := binary.LittleEndian.Uint64(header[2:10])
		length := binary.LittleEndian.Uint64(header[10:18])

		keyBuf := make([]byte, kLen)
		if _, err := io.ReadFull(idxReader, keyBuf); err != nil {
			break
		}
		indexEntries = append(indexEntries, IndexEntry{
			LastKey: string(keyBuf),
			Offset:  offset,
			Length:  length,
		})
	}

	minKey := ""
	maxKey := ""
	if len(indexEntries) > 0 {
		maxKey = indexEntries[len(indexEntries)-1].LastKey
	}

	return &SSTableReader{
		file: file,
		meta: SSTableMetadata{
			ID:        id,
			Level:     level,
			MinKey:    minKey,
			MaxKey:    maxKey,
			FileBytes: stat.Size(),
			Path:      path,
		},
		bloom:        bloom,
		indexEntries: indexEntries,
	}, nil
}

// Get performs a point lookup with Bloom filter pre-check and binary search on index.
// Returns (value, isTombstone, found, error).
func (r *SSTableReader) Get(key string) ([]byte, bool, bool, error) {
	// 1. In-memory Bloom Filter fast check (avoids disk seek if key not present)
	if !r.bloom.MayContain(key) {
		return nil, false, false, nil
	}

	// 2. Binary search across Index Entries to find candidate data block
	idx := sort.Search(len(r.indexEntries), func(i int) bool {
		return r.indexEntries[i].LastKey >= key
	})

	if idx >= len(r.indexEntries) {
		return nil, false, false, nil
	}

	targetBlock := r.indexEntries[idx]

	// 3. Read data block from disk
	blockBuf := make([]byte, targetBlock.Length)
	if _, err := r.file.ReadAt(blockBuf, int64(targetBlock.Offset)); err != nil {
		return nil, false, false, fmt.Errorf("failed to read data block: %w", err)
	}

	// 4. Scan data block entries
	rdr := bytes.NewReader(blockBuf)
	for rdr.Len() > 0 {
		var header [15]byte
		if _, err := io.ReadFull(rdr, header[:]); err != nil {
			break
		}
		kLen := binary.LittleEndian.Uint16(header[0:2])
		vLen := binary.LittleEndian.Uint32(header[2:6])
		isTombstone := header[6] == 1
		// timestamp := binary.LittleEndian.Uint64(header[7:15])

		payload := make([]byte, int(kLen)+int(vLen))
		if _, err := io.ReadFull(rdr, payload); err != nil {
			break
		}

		entryKey := string(payload[:kLen])
		if entryKey == key {
			if isTombstone {
				return nil, true, true, nil
			}
			val := payload[kLen:]
			return val, false, true, nil
		}
		if entryKey > key {
			break
		}
	}

	return nil, false, false, nil
}

// ScanAll reads all records from this SSTable in ascending sorted order.
func (r *SSTableReader) ScanAll() ([]Entry, error) {
	var entries []Entry
	for _, ie := range r.indexEntries {
		blockBuf := make([]byte, ie.Length)
		if _, err := r.file.ReadAt(blockBuf, int64(ie.Offset)); err != nil {
			return nil, err
		}

		rdr := bytes.NewReader(blockBuf)
		for rdr.Len() > 0 {
			var header [15]byte
			if _, err := io.ReadFull(rdr, header[:]); err != nil {
				break
			}
			kLen := binary.LittleEndian.Uint16(header[0:2])
			vLen := binary.LittleEndian.Uint32(header[2:6])
			isTombstone := header[6] == 1
			ts := int64(binary.LittleEndian.Uint64(header[7:15]))

			payload := make([]byte, int(kLen)+int(vLen))
			if _, err := io.ReadFull(rdr, payload); err != nil {
				break
			}

			k := string(payload[:kLen])
			var v []byte
			if !isTombstone && vLen > 0 {
				v = make([]byte, vLen)
				copy(v, payload[kLen:])
			}

			entries = append(entries, Entry{
				Key:         k,
				Value:       v,
				IsTombstone: isTombstone,
				Timestamp:   ts,
			})
		}
	}
	return entries, nil
}

// Close closes the underlying SSTable file descriptor.
func (r *SSTableReader) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.file != nil {
		return r.file.Close()
	}
	return nil
}

// Metadata returns the SSTable metadata.
func (r *SSTableReader) Metadata() SSTableMetadata {
	return r.meta
}

// IndexList returns the index entries for debugging / visualizers.
func (r *SSTableReader) IndexList() []IndexEntry {
	return r.indexEntries
}
