package lsm

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"sync"
	"time"
)

var (
	ErrCorruptWAL = errors.New("corrupted WAL frame: CRC32 mismatch")
	ErrShortRead  = errors.New("unexpected EOF while reading WAL frame")
)

// WALEntry represents a single record in the Write-Ahead Log.
// Binary format:
// [CRC32 Checksum (4B)][Timestamp (8B)][Key Size (4B)][Value Size (4B)][Key (VarBytes)][Value (VarBytes)]
type WALEntry struct {
	CRC32       uint32
	Timestamp   int64
	Key         string
	Value       []byte
	IsTombstone bool
}

// WAL manages the append-only binary log file with fsync support.
type WAL struct {
	mu       sync.Mutex
	file     *os.File
	path     string
	byteSize int64
}

// OpenWAL opens or creates a WAL file at the given path.
func OpenWAL(path string) (*WAL, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open WAL file: %w", err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to stat WAL file: %w", err)
	}

	return &WAL{
		file:     file,
		path:     path,
		byteSize: info.Size(),
	}, nil
}

// Write appends a key-value pair or tombstone to the WAL and performs fsync.
func (w *WAL) Write(key string, value []byte, isTombstone bool) (*WALEntry, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	ts := time.Now().UnixNano()
	kBytes := []byte(key)
	kSize := uint32(len(kBytes))

	var vSize uint32
	var vBytes []byte
	if !isTombstone && value != nil {
		vBytes = value
		vSize = uint32(len(value))
	} else {
		vSize = 0
	}

	// Payload over which CRC32 is calculated: [Timestamp (8B)][Key Size (4B)][Value Size (4B)][Key][Value]
	payloadSize := 8 + 4 + 4 + len(kBytes) + len(vBytes)
	payload := make([]byte, payloadSize)

	binary.LittleEndian.PutUint64(payload[0:8], uint64(ts))
	binary.LittleEndian.PutUint32(payload[8:12], kSize)
	binary.LittleEndian.PutUint32(payload[12:16], vSize)
	copy(payload[16:16+len(kBytes)], kBytes)
	if vSize > 0 {
		copy(payload[16+len(kBytes):], vBytes)
	}

	checksum := crc32.ChecksumIEEE(payload)

	// Total frame: [CRC32 (4B)][Payload]
	frame := make([]byte, 4+payloadSize)
	binary.LittleEndian.PutUint32(frame[0:4], checksum)
	copy(frame[4:], payload)

	n, err := w.file.Write(frame)
	if err != nil {
		return nil, fmt.Errorf("wal write failed: %w", err)
	}

	// Immediate fsync for crash safety guarantee
	if err := w.file.Sync(); err != nil {
		return nil, fmt.Errorf("wal fsync failed: %w", err)
	}

	w.byteSize += int64(n)

	return &WALEntry{
		CRC32:       checksum,
		Timestamp:   ts,
		Key:         key,
		Value:       value,
		IsTombstone: isTombstone,
	}, nil
}

// Recover reads all valid entries from the beginning of the WAL file.
func (w *WAL) Recover() ([]*WALEntry, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if _, err := w.file.Seek(0, io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek to start failed: %w", err)
	}

	var entries []*WALEntry
	headerBuf := make([]byte, 20) // 4 (CRC) + 8 (TS) + 4 (KSize) + 4 (VSize)

	for {
		_, err := io.ReadFull(w.file, headerBuf)
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		}
		if err != nil {
			return entries, fmt.Errorf("failed to read frame header: %w", err)
		}

		expectedChecksum := binary.LittleEndian.Uint32(headerBuf[0:4])
		ts := int64(binary.LittleEndian.Uint64(headerBuf[4:12]))
		kSize := binary.LittleEndian.Uint32(headerBuf[12:16])
		vSize := binary.LittleEndian.Uint32(headerBuf[16:20])

		payloadBuf := make([]byte, 16+kSize+vSize)
		copy(payloadBuf[0:16], headerBuf[4:20]) // [Timestamp, KSize, VSize]

		dataBuf := make([]byte, kSize+vSize)
		if _, err := io.ReadFull(w.file, dataBuf); err != nil {
			// Incomplete trailing write on crash - recover up to this point
			break
		}
		copy(payloadBuf[16:], dataBuf)

		// Verify CRC32 checksum
		actualChecksum := crc32.ChecksumIEEE(payloadBuf)
		if actualChecksum != expectedChecksum {
			return entries, ErrCorruptWAL
		}

		key := string(dataBuf[:kSize])
		var val []byte
		var isTombstone bool
		if vSize > 0 {
			val = make([]byte, vSize)
			copy(val, dataBuf[kSize:])
			isTombstone = false
		} else {
			val = nil
			isTombstone = true
		}

		entries = append(entries, &WALEntry{
			CRC32:       actualChecksum,
			Timestamp:   ts,
			Key:         key,
			Value:       val,
			IsTombstone: isTombstone,
		})
	}

	// Seek to the end for subsequent appends
	if _, err := w.file.Seek(0, io.SeekEnd); err != nil {
		return entries, fmt.Errorf("seek to end failed: %w", err)
	}

	return entries, nil
}

// Reset truncates the current WAL file (invoked after memtable is safely flushed to SSTable).
func (w *WAL) Reset() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if err := w.file.Truncate(0); err != nil {
		return fmt.Errorf("wal truncate failed: %w", err)
	}
	if _, err := w.file.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("wal seek failed: %w", err)
	}
	w.byteSize = 0
	return w.file.Sync()
}

// Close closes the underlying WAL file.
func (w *WAL) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.file.Close()
}

// Size returns the approximate byte size of the WAL.
func (w *WAL) Size() int64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.byteSize
}
