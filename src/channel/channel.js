import { PacketType } from '../core/packet.js';

/**
 * Channel class models the physical medium between Sender and Receiver.
 * Implements:
 * - Transmission delay: size / bandwidth
 * - Propagation delay
 * - Random jitter (can reorder packets)
 * - Random packet drop by probability
 * - Scripted drops for exact test scenarios
 * - Bit corruption detected via CRC
 */
export class Channel {
  /**
   * @param {Object} options
   * @param {import('../core/engine.js').Simulator} options.simulator
   * @param {import('../core/config.js').SimulationConfig} options.config
   * @param {import('../metrics/collector.js').MetricsCollector} options.metrics
   * @param {import('../metrics/tracer.js').EventTracer} options.tracer
   */
  constructor({ simulator, config, metrics, tracer }) {
    this.sim = simulator;
    this.config = config;
    this.metrics = metrics;
    this.tracer = tracer;

    // Track attempt counts per sequence number for scripted drops (DATA and ACK separately)
    this.dataAttempts = new Map();
    this.ackAttempts = new Map();
  }

  /**
   * Send a packet across the forward (Data) or reverse (ACK) channel
   * @param {import('../core/packet.js').Packet} packet
   * @param {Function} deliverFn Callback when packet arrives at recipient
   */
  transmit(packet, deliverFn) {
    const isAck = packet.type === PacketType.ACK || packet.type === PacketType.NAK;
    const direction = isAck ? 'Receiver -> Sender' : 'Sender -> Receiver';

    // Track attempt counts for scripted loss (separate maps for DATA vs ACK)
    const attemptMap = isAck ? this.ackAttempts : this.dataAttempts;
    const attempt = (attemptMap.get(packet.absSeq) || 0) + 1;
    attemptMap.set(packet.absSeq, attempt);

    // 1. Check scripted loss (only applies to DATA frames; use ackLossRate for ACK drops)
    const isScriptedDrop = !isAck && this.config.scriptedDrops.some(d => {
      const seqMatches = d.absSeq !== undefined
        ? d.absSeq === packet.absSeq
        : (d.seq !== undefined ? d.seq === packet.seq : false);
      const attemptMatches = d.attempt === undefined || d.attempt === attempt;
      return seqMatches && attemptMatches;
    });

    // 2. Check random loss
    const lossProb = isAck ? this.config.ackLossRate : this.config.lossRate;
    const isRandomDrop = this.sim.rng.chance(lossProb);

    if (isScriptedDrop || isRandomDrop) {
      if (this.metrics) this.metrics.recordDrop(packet);
      if (this.tracer) {
        this.tracer.log({
          time: this.sim.now,
          type: 'DROP',
          packet,
          reason: isScriptedDrop ? 'scripted drop' : 'random loss',
          direction
        });
      }
      return; // Dropped, do not schedule delivery
    }

    // 3. Compute transmission and propagation delay
    // bandwidth in bits/sec, packet.size in bytes -> size * 8 / bandwidth
    const txDelay = (packet.size * 8) / this.config.bandwidth;
    const propDelay = this.config.propagationDelay;
    const jitter = this.config.jitter > 0 ? this.sim.rng.uniform(0, this.config.jitter) : 0;
    const totalDelay = txDelay + propDelay + jitter;

    // 4. Check bit corruption
    const corruptedPacket = packet.clone();
    let isCorrupted = false;
    if (this.sim.rng.chance(this.config.corruptionRate)) {
      corruptedPacket.corrupt();
      isCorrupted = true;
      if (this.metrics) this.metrics.recordCorruption(packet);
    }

    if (this.tracer) {
      this.tracer.log({
        time: this.sim.now,
        type: isAck ? 'SEND_ACK' : 'SEND_DATA',
        packet,
        delay: totalDelay,
        direction,
        corrupted: isCorrupted
      });
    }

    // Schedule arrival event
    this.sim.schedule(
      totalDelay,
      () => {
        if (this.tracer) {
          this.tracer.log({
            time: this.sim.now,
            type: isAck ? 'RECV_ACK' : 'RECV_DATA',
            packet: corruptedPacket,
            direction
          });
        }
        deliverFn(corruptedPacket);
      },
      [],
      `Arrival of ${packet.type} seq=${packet.seq}`
    );
  }
}
