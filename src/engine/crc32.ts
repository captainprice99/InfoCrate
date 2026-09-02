// IEEE 802.3 CRC32 implementation matching Go hash/crc32.ChecksumIEEE
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function crc32IEEE(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const tableIndex = (crc ^ data[i]) & 0xff;
    crc = (CRC32_TABLE[tableIndex] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash = hash ^ BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

export function murmur3_64(str: string): bigint {
  // 64-bit non-cryptographic hash
  let h = 0x5bd1e995n;
  for (let i = 0; i < str.length; i++) {
    let k = BigInt(str.charCodeAt(i));
    k = (k * 0xcc9e2d51n) & 0xffffffffffffffffn;
    k = ((k << 15n) | (k >> 49n)) & 0xffffffffffffffffn;
    k = (k * 0x1b873593n) & 0xffffffffffffffffn;
    h = h ^ k;
    h = ((h << 13n) | (h >> 51n)) & 0xffffffffffffffffn;
    h = (h * 5n + 0xe6546b64n) & 0xffffffffffffffffn;
  }
  return h;
}
