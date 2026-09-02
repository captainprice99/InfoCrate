import { crc32IEEE, fnv1a64, murmur3_64 } from './crc32';
import { WalFrame, SkipListNodeView, SSTableView, SSTableBlockView } from '../types/infocrate';

export class SimulatedLsmEngine {
  private memtable: Map<string, { value: string | null; isTombstone: boolean; ts: number; height: number }> = new Map();
  private immutable: Map<string, { value: string | null; isTombstone: boolean; ts: number; height: number }>[] = [];
  private l0Tables: SSTableView[] = [];
  private l1Tables: SSTableView[] = [];
  private walFrames: WalFrame[] = [];
  private nextSSTableId = 1;
  private currentOffset = 0;

  constructor(initialData?: Record<string, string>) {
    if (initialData) {
      for (const [k, v] of Object.entries(initialData)) {
        this.put(k, v);
      }
    }
  }

  // Generate Skip List random level between 1 and 8
  private randomHeight(): number {
    let height = 1;
    while (height < 8 && Math.random() < 0.5) {
      height++;
    }
    return height;
  }

  public put(key: string, value: string): WalFrame {
    const ts = Date.now() * 1000000 + Math.floor(Math.random() * 1000);
    const keyBytes = new TextEncoder().encode(key);
    const valBytes = new TextEncoder().encode(value);

    // [Timestamp (8B)][Key Size (4B)][Value Size (4B)][Key][Value]
    const payload = new Uint8Array(16 + keyBytes.length + valBytes.length);
    const view = new DataView(payload.buffer);
    view.setBigUint64(0, BigInt(ts), true);
    view.setUint32(8, keyBytes.length, true);
    view.setUint32(12, valBytes.length, true);
    payload.set(keyBytes, 16);
    payload.set(valBytes, 16 + keyBytes.length);

    const checksum = crc32IEEE(payload);
    const crcHex = '0x' + checksum.toString(16).padStart(8, '0').toUpperCase();

    // Raw hex representation of [CRC32 (4B)][Payload]
    const rawFrame = new Uint8Array(4 + payload.length);
    new DataView(rawFrame.buffer).setUint32(0, checksum, true);
    rawFrame.set(payload, 4);

    let hexStr = '';
    for (let i = 0; i < Math.min(rawFrame.length, 32); i++) {
      hexStr += rawFrame[i].toString(16).padStart(2, '0').toUpperCase() + ' ';
    }
    if (rawFrame.length > 32) hexStr += '...';

    const walFrame: WalFrame = {
      offset: this.currentOffset,
      crc32: crcHex,
      crcValid: true,
      timestamp: ts,
      keySize: keyBytes.length,
      valSize: valBytes.length,
      key,
      value,
      isTombstone: false,
      rawHex: hexStr.trim(),
    };

    this.walFrames.unshift(walFrame);
    if (this.walFrames.length > 50) this.walFrames.pop();
    this.currentOffset += rawFrame.length;

    // Insert into Skip List Memtable
    const existing = this.memtable.get(key);
    const height = existing ? existing.height : this.randomHeight();
    this.memtable.set(key, { value, isTombstone: false, ts, height });

    // Rotate memtable if limit reached (e.g. >= 8 entries for visualization)
    if (this.memtable.size >= 8) {
      this.rotateAndFlush();
    }

    return walFrame;
  }

  public delete(key: string): WalFrame {
    const ts = Date.now() * 1000000 + Math.floor(Math.random() * 1000);
    const keyBytes = new TextEncoder().encode(key);

    const payload = new Uint8Array(16 + keyBytes.length);
    const view = new DataView(payload.buffer);
    view.setBigUint64(0, BigInt(ts), true);
    view.setUint32(8, keyBytes.length, true);
    view.setUint32(12, 0, true);
    payload.set(keyBytes, 16);

    const checksum = crc32IEEE(payload);
    const crcHex = '0x' + checksum.toString(16).padStart(8, '0').toUpperCase();

    const rawFrame = new Uint8Array(4 + payload.length);
    new DataView(rawFrame.buffer).setUint32(0, checksum, true);
    rawFrame.set(payload, 4);

    let hexStr = '';
    for (let i = 0; i < Math.min(rawFrame.length, 32); i++) {
      hexStr += rawFrame[i].toString(16).padStart(2, '0').toUpperCase() + ' ';
    }

    const walFrame: WalFrame = {
      offset: this.currentOffset,
      crc32: crcHex,
      crcValid: true,
      timestamp: ts,
      keySize: keyBytes.length,
      valSize: 0,
      key,
      value: null,
      isTombstone: true,
      rawHex: hexStr.trim(),
    };

    this.walFrames.unshift(walFrame);
    if (this.walFrames.length > 50) this.walFrames.pop();
    this.currentOffset += rawFrame.length;

    const existing = this.memtable.get(key);
    const height = existing ? existing.height : this.randomHeight();
    this.memtable.set(key, { value: null, isTombstone: true, ts, height });

    if (this.memtable.size >= 8) {
      this.rotateAndFlush();
    }

    return walFrame;
  }

  public get(key: string): { value: string | null; found: boolean; location: string; bloomChecked: boolean } {
    // 1. Memtable
    if (this.memtable.has(key)) {
      const entry = this.memtable.get(key)!;
      if (entry.isTombstone) return { value: null, found: false, location: 'Memtable (Tombstone)', bloomChecked: false };
      return { value: entry.value, found: true, location: 'Active Memtable (Skip List)', bloomChecked: false };
    }

    // 2. Immutable Memtables
    for (let i = 0; i < this.immutable.length; i++) {
      if (this.immutable[i].has(key)) {
        const entry = this.immutable[i].get(key)!;
        if (entry.isTombstone) return { value: null, found: false, location: `Immutable Memtable #${i} (Tombstone)`, bloomChecked: false };
        return { value: entry.value, found: true, location: `Immutable Memtable #${i}`, bloomChecked: false };
      }
    }

    // 3. Level 0 SSTables
    for (const table of this.l0Tables) {
      const mayContain = this.checkBloomFilter(table, key);
      if (!mayContain) continue;

      for (const block of table.blocks) {
        for (const entry of block.entries) {
          if (entry.key === key) {
            if (entry.isTombstone) return { value: null, found: false, location: `L0 SSTable ${table.filename} (Tombstone)`, bloomChecked: true };
            return { value: entry.value, found: true, location: `L0 SSTable ${table.filename}`, bloomChecked: true };
          }
        }
      }
    }

    // 4. Level 1 SSTables
    for (const table of this.l1Tables) {
      if (key < table.minKey || key > table.maxKey) continue;
      const mayContain = this.checkBloomFilter(table, key);
      if (!mayContain) continue;

      for (const block of table.blocks) {
        for (const entry of block.entries) {
          if (entry.key === key) {
            if (entry.isTombstone) return { value: null, found: false, location: `L1 SSTable ${table.filename} (Tombstone)`, bloomChecked: true };
            return { value: entry.value, found: true, location: `L1 SSTable ${table.filename}`, bloomChecked: true };
          }
        }
      }
    }

    return { value: null, found: false, location: 'Not Found in Any Level', bloomChecked: true };
  }

  public rotateAndFlush(): void {
    if (this.memtable.size === 0) return;

    const entriesToFlush = Array.from(this.memtable.entries())
      .map(([key, data]) => ({
        key,
        value: data.value,
        isTombstone: data.isTombstone,
        timestamp: data.ts,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    this.memtable.clear();

    const table = this.createSSTable(entriesToFlush, 0);
    this.l0Tables.unshift(table);

    if (this.l0Tables.length >= 3) {
      this.triggerCompaction();
    }
  }

  public triggerCompaction(): void {
    if (this.l0Tables.length < 2) return;

    const tablesToMerge = [...this.l0Tables];
    this.l0Tables = [];

    const allEntries: { key: string; value: string | null; isTombstone: boolean; timestamp: number }[] = [];
    for (const table of tablesToMerge) {
      for (const block of table.blocks) {
        allEntries.push(...block.entries);
      }
    }

    // Sort by key ascending, then timestamp descending
    allEntries.sort((a, b) => {
      if (a.key === b.key) return b.timestamp - a.timestamp;
      return a.key.localeCompare(b.key);
    });

    // Deduplicate and drop bottom-level tombstones
    const merged: { key: string; value: string | null; isTombstone: boolean; timestamp: number }[] = [];
    const seen = new Set<string>();

    for (const entry of allEntries) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      if (entry.isTombstone) continue; // GC tombstone at L1
      merged.push(entry);
    }

    if (merged.length > 0) {
      const l1Table = this.createSSTable(merged, 1);
      this.l1Tables.push(l1Table);
    }
  }

  private createSSTable(
    entries: { key: string; value: string | null; isTombstone: boolean; timestamp: number }[],
    level: number
  ): SSTableView {
    const id = this.nextSSTableId++;
    const filename = `sstable_L${level}_${id.toString().padStart(6, '0')}.sst`;

    // Bloom filter (64 bits, 4 hash functions)
    const numBits = 64;
    const numHash = 4;
    const bits: boolean[] = new Array(numBits).fill(false);

    for (const e of entries) {
      const h1 = Number(fnv1a64(e.key) % BigInt(numBits));
      const h2 = Number(murmur3_64(e.key) % BigInt(numBits));
      for (let i = 0; i < numHash; i++) {
        const bit = Math.abs((h1 + i * h2) % numBits);
        bits[bit] = true;
      }
    }

    // Chunk into data blocks (3 entries per block for visualization)
    const blocks: SSTableBlockView[] = [];
    const blockSize = 3;
    let offset = 0;

    for (let i = 0; i < entries.length; i += blockSize) {
      const chunk = entries.slice(i, i + blockSize);
      const lastKey = chunk[chunk.length - 1].key;
      const length = chunk.reduce((sum, item) => sum + item.key.length + (item.value?.length || 0) + 15, 0);

      blocks.push({
        blockIndex: blocks.length,
        offset,
        length,
        lastKey,
        entries: chunk,
      });
      offset += length;
    }

    const minKey = entries[0]?.key || '';
    const maxKey = entries[entries.length - 1]?.key || '';

    return {
      id,
      level,
      minKey,
      maxKey,
      entryCount: entries.length,
      fileBytes: offset + 64 + 40, // data + bloom + footer
      filename,
      bloomBitArray: bits,
      bloomNumBits: numBits,
      bloomNumHash: numHash,
      blocks,
    };
  }

  private checkBloomFilter(table: SSTableView, key: string): boolean {
    const numBits = table.bloomNumBits;
    const numHash = table.bloomNumHash;
    const h1 = Number(fnv1a64(key) % BigInt(numBits));
    const h2 = Number(murmur3_64(key) % BigInt(numBits));

    for (let i = 0; i < numHash; i++) {
      const bit = Math.abs((h1 + i * h2) % numBits);
      if (!table.bloomBitArray[bit]) {
        return false; // Guaranteed not in table
      }
    }
    return true; // May be in table
  }

  public getMemtableSnapshot(): SkipListNodeView[] {
    return Array.from(this.memtable.entries())
      .map(([key, data]) => ({
        key,
        value: data.value,
        isTombstone: data.isTombstone,
        timestamp: data.ts,
        height: data.height,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  public getWalFrames(): WalFrame[] {
    return this.walFrames;
  }

  public getL0Tables(): SSTableView[] {
    return this.l0Tables;
  }

  public getL1Tables(): SSTableView[] {
    return this.l1Tables;
  }
}
