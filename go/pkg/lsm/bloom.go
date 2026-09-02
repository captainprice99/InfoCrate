package lsm

import (
	"encoding/binary"
	"hash/fnv"
	"math"

	"github.com/spaolacci/murmur3"
)

// BloomFilter provides probabilistic set membership testing to avoid unnecessary disk I/O.
type BloomFilter struct {
	bits     []byte
	numBits  uint32
	numHash  uint32
	keyCount uint32
}

// NewBloomFilter creates a bloom filter optimized for expectedKeys and target false-positive rate.
func NewBloomFilter(expectedKeys int, falsePositiveRate float64) *BloomFilter {
	if expectedKeys <= 0 {
		expectedKeys = 1
	}
	if falsePositiveRate <= 0 || falsePositiveRate >= 1 {
		falsePositiveRate = 0.01 // Default 1%
	}

	// Formula: m = - (n * ln(p)) / (ln(2)^2)
	n := float64(expectedKeys)
	m := - (n * math.Log(falsePositiveRate)) / (math.Ln2 * math.Ln2)
	numBits := uint32(math.Ceil(m))
	if numBits < 64 {
		numBits = 64
	}

	// Formula: k = (m / n) * ln(2)
	k := (float64(numBits) / n) * math.Ln2
	numHash := uint32(math.Round(k))
	if numHash < 1 {
		numHash = 1
	}

	numBytes := (numBits + 7) / 8
	return &BloomFilter{
		bits:    make([]byte, numBytes),
		numBits: numBits,
		numHash: numHash,
	}
}

// hashValues computes two independent 64-bit hash values for double hashing.
func (bf *BloomFilter) hashValues(data []byte) (uint64, uint64) {
	// Hash 1: FNV-1a 64-bit
	h1 := fnv.New64a()
	h1.Write(data)
	v1 := h1.Sum64()

	// Hash 2: Murmur3 64-bit
	v2 := murmur3.Sum64(data)

	return v1, v2
}

// Add inserts a key into the Bloom filter.
func (bf *BloomFilter) Add(key string) {
	kBytes := []byte(key)
	h1, h2 := bf.hashValues(kBytes)

	for i := uint32(0); i < bf.numHash; i++ {
		// Double hashing: g_i(x) = h1(x) + i * h2(x) mod numBits
		bitIdx := (h1 + uint64(i)*h2) % uint64(bf.numBits)
		byteIdx := bitIdx / 8
		bitOffset := bitIdx % 8
		bf.bits[byteIdx] |= (1 << bitOffset)
	}
	bf.keyCount++
}

// MayContain tests if the key might exist in the set.
// If it returns false, the key is guaranteed NOT to exist.
func (bf *BloomFilter) MayContain(key string) bool {
	if bf.numBits == 0 || len(bf.bits) == 0 {
		return true
	}

	kBytes := []byte(key)
	h1, h2 := bf.hashValues(kBytes)

	for i := uint32(0); i < bf.numHash; i++ {
		bitIdx := (h1 + uint64(i)*h2) % uint64(bf.numBits)
		byteIdx := bitIdx / 8
		bitOffset := bitIdx % 8
		if (bf.bits[byteIdx] & (1 << bitOffset)) == 0 {
			return false
		}
	}
	return true
}

// Encode serializes the Bloom filter to binary:
// [NumBits (4B)][NumHash (4B)][KeyCount (4B)][Bits Payload (VarBytes)]
func (bf *BloomFilter) Encode() []byte {
	buf := make([]byte, 12+len(bf.bits))
	binary.LittleEndian.PutUint32(buf[0:4], bf.numBits)
	binary.LittleEndian.PutUint32(buf[4:8], bf.numHash)
	binary.LittleEndian.PutUint32(buf[8:12], bf.keyCount)
	copy(buf[12:], bf.bits)
	return buf
}

// DecodeBloomFilter deserializes a Bloom filter from binary.
func DecodeBloomFilter(data []byte) (*BloomFilter, error) {
	if len(data) < 12 {
		return nil, ErrShortRead
	}

	numBits := binary.LittleEndian.Uint32(data[0:4])
	numHash := binary.LittleEndian.Uint32(data[4:8])
	keyCount := binary.LittleEndian.Uint32(data[8:12])
	bits := make([]byte, len(data)-12)
	copy(bits, data[12:])

	return &BloomFilter{
		bits:     bits,
		numBits:  numBits,
		numHash:  numHash,
		keyCount: keyCount,
	}, nil
}

// FalsePositiveRate calculates the current estimated false positive rate.
func (bf *BloomFilter) FalsePositiveRate() float64 {
	if bf.numBits == 0 || bf.keyCount == 0 {
		return 0.0
	}
	// Formula: (1 - e^(-k * n / m))^k
	exponent := -float64(bf.numHash) * float64(bf.keyCount) / float64(bf.numBits)
	return math.Pow(1.0-math.Exp(exponent), float64(bf.numHash))
}
