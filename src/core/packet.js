/**
 * CRC-32 Error Detection Implementation
 * Computes standard 32-bit Cyclic Redundancy Check for bit corruption detection.
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

export function computeCRC32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    const byte = str.charCodeAt(i) & 0xFF;
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Packet Types
 */
export const PacketType = Object.freeze({
  DATA: 'DATA',
  ACK: 'ACK',
  NAK: 'NAK'
});

/**
 * Packet model with modular sequence number and CRC checksum
 */
export class Packet {
  /**
   * @param {Object} options
   * @param {number} options.seq - Sequence number on the wire (modulo 2^k)
   * @param {number} options.absSeq - Internal absolute sequence number
   * @param {string} options.type - PacketType.DATA | PacketType.ACK | PacketType.NAK
   * @param {any} options.payload - Payload data or content
   * @param {number} options.size - Size in bytes (default 1024 for DATA, 64 for ACK)
   * @param {number} [options.checksum] - Optional precomputed checksum
   */
  constructor({
    seq,
    absSeq = seq,
    type = PacketType.DATA,
    payload = '',
    size = type === PacketType.DATA ? 1024 : 64,
    checksum = null
  }) {
    this.seq = seq;
    this.absSeq = absSeq;
    this.type = type;
    this.payload = String(payload);
    this.size = size;
    this.checksum = checksum !== null ? checksum : this.calculateChecksum();
  }

  /**
   * Serialize payload & header components to compute CRC
   */
  calculateChecksum() {
    const serialized = `${this.seq}:${this.type}:${this.payload}`;
    return computeCRC32(serialized);
  }

  /**
   * Validate whether this packet has been corrupted
   */
  isValid() {
    return this.calculateChecksum() === this.checksum;
  }

  /**
   * Corrupt packet contents or checksum to simulate bit errors
   */
  corrupt() {
    // Flip checksum bits or tamper with payload
    this.checksum ^= 0xDEADBEEF;
  }

  clone() {
    return new Packet({
      seq: this.seq,
      absSeq: this.absSeq,
      type: this.type,
      payload: this.payload,
      size: this.size,
      checksum: this.checksum
    });
  }

  toString() {
    return `[${this.type} seq=${this.seq} abs=${this.absSeq} size=${this.size}B crc=${this.checksum.toString(16)}]`;
  }
}
