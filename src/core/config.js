/**
 * Protocol Types
 */
export const ProtocolType = Object.freeze({
  STOP_AND_WAIT: 'STOP_AND_WAIT',
  GO_BACK_N: 'GO_BACK_N',
  SELECTIVE_REPEAT: 'SELECTIVE_REPEAT'
});

/**
 * Simulation Configuration Class
 * Validates 2^k window sizing constraints as specified in the document:
 * - Stop-and-Wait: k >= 1, W_s = 1, W_r = 1
 * - Go-Back-N: 2^k >= W_s + 1, W_r = 1
 * - Selective Repeat: 2^k >= W_s + W_r
 */
export class SimulationConfig {
  constructor({
    protocol = ProtocolType.GO_BACK_N,
    k = 3,                 // Sequence number bits (modulo 2^k)
    senderWindow = 4,      // W_s
    receiverWindow = 1,    // W_r
    numFrames = 20,        // Total packets to send
    packetSize = 1024,     // Bytes
    ackSize = 64,          // Bytes
    bandwidth = 1e6,       // 1 Mbps (bits/s)
    propagationDelay = 0.05, // 50 ms (seconds)
    jitter = 0.0,          // Max random jitter in seconds
    lossRate = 0.0,        // Probability of dropping packet (0.0 to 1.0)
    ackLossRate = 0.0,     // Probability of dropping ACK
    corruptionRate = 0.0,  // Probability of CRC corruption
    scriptedDrops = [],    // Array of { seq, attempt } or { absSeq, attempt }
    rto = null,            // Retransmission Timeout (s). If null, computed as default 2*(transmit + prop)
    seed = 42,             // Seed for deterministic RNG
    fastRetransmit = false, // Fast Retransmit on 3 duplicate ACKs (Phase 6)
    enableNak = false,     // Negative ACKs (NAK) for Selective Repeat (Phase 6)
    adaptiveRto = false    // Dynamic RTO estimation via Jacobson/Karels (Phase 6)
  } = {}) {
    this.protocol = protocol.toUpperCase();
    this.k = k;
    this.modulus = 1 << k; // 2^k
    this.senderWindow = senderWindow;
    this.receiverWindow = receiverWindow;
    this.numFrames = numFrames;
    this.packetSize = packetSize;
    this.ackSize = ackSize;
    this.bandwidth = bandwidth;
    this.propagationDelay = propagationDelay;
    this.jitter = jitter;
    this.lossRate = lossRate;
    this.ackLossRate = ackLossRate;
    this.corruptionRate = corruptionRate;
    this.scriptedDrops = scriptedDrops;
    this.seed = seed;
    this.fastRetransmit = Boolean(fastRetransmit);
    this.enableNak = Boolean(enableNak);
    this.adaptiveRto = Boolean(adaptiveRto);

    // Derived timing calculations:
    // transmitTime = (size * 8) / bandwidth
    const txTimeData = (this.packetSize * 8) / this.bandwidth;
    const txTimeAck = (this.ackSize * 8) / this.bandwidth;
    const rttEstimate = txTimeData + this.propagationDelay + txTimeAck + this.propagationDelay;
    this.rttEstimate = rttEstimate;
    this.rto = rto !== null ? rto : Math.max(0.2, rttEstimate * 2.0);

    this.validate();
  }

  /**
   * Validate window sizing and sequence constraints according to network theory
   */
  validate() {
    if (this.k < 1) {
      throw new Error(`Invalid sequence bits k=${this.k}. k must be >= 1.`);
    }

    switch (this.protocol) {
      case ProtocolType.STOP_AND_WAIT:
        this.senderWindow = 1;
        this.receiverWindow = 1;
        if (this.modulus < 2) {
          throw new Error('Stop-and-Wait requires k >= 1 (modulus >= 2)');
        }
        break;

      case ProtocolType.GO_BACK_N:
        this.receiverWindow = 1;
        if (this.modulus < this.senderWindow + 1) {
          throw new Error(
            `GBN constraint violation: 2^k (${this.modulus}) must be >= W_s + 1 (${this.senderWindow + 1})`
          );
        }
        break;

      case ProtocolType.SELECTIVE_REPEAT:
        if (this.modulus < this.senderWindow + this.receiverWindow) {
          throw new Error(
            `Selective Repeat constraint violation: 2^k (${this.modulus}) must be >= W_s + W_r (${this.senderWindow + this.receiverWindow})`
          );
        }
        break;

      default:
        throw new Error(`Unknown protocol: ${this.protocol}`);
    }
  }
}
