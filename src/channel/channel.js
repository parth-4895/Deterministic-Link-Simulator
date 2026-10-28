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

    // FIFO transmission queues to serialize frames behind previous frame on the link
    this.forwardQueue = [];
    this.forwardBusy = false;

    this.reverseQueue = [];
    this.reverseBusy = false;
  }

  /**
   * Send a packet across the forward (Data) or reverse (ACK) channel.
   * Frames are placed in the transmitter FIFO queue and serialize behind
   * preceding frames before arrival events are added to the simulator priority queue.
   * @param {import('../core/packet.js').Packet} packet
   * @param {Function} deliverFn Callback when packet arrives at recipient
   */
  transmit(packet, deliverFn) {
    const isAck = packet.type === PacketType.ACK || packet.type === PacketType.NAK;
    if (isAck) {
      this.reverseQueue.push({ packet, deliverFn });
      if (!this.reverseBusy) {
        this._processNext(true);
      }
    } else {
      this.forwardQueue.push({ packet, deliverFn });
      if (!this.forwardBusy) {
        this._processNext(false);
      }
    }
  }

  /**
   * Process the next frame from the transmitter queue.
   * @param {boolean} isAck Whether this is the reverse (ACK) channel
   * @private
   */
  _processNext(isAck) {
    const queue = isAck ? this.reverseQueue : this.forwardQueue;
    if (queue.length === 0) {
      if (isAck) {
        this.reverseBusy = false;
      } else {
        this.forwardBusy = false;
      }
      return;
    }

    if (isAck) {
      this.reverseBusy = true;
    } else {
      this.forwardBusy = true;
    }

    const { packet, deliverFn } = queue.shift();
    const direction = isAck ? 'Receiver -> Sender' : 'Sender -> Receiver';

    // Track attempt counts for scripted loss (separate maps for DATA vs ACK)
    const attemptMap = isAck ? this.ackAttempts : this.dataAttempts;
    const attempt = (attemptMap.get(packet.absSeq) || 0) + 1;
    attemptMap.set(packet.absSeq, attempt);

    // Compute transmission delay: bandwidth in bits/sec, packet.size in bytes -> size * 8 / bandwidth
    const txDelay = (packet.size * 8) / this.config.bandwidth;
    const propDelay = this.config.propagationDelay;
    const jitter = this.config.jitter > 0 ? this.sim.rng.uniform(0, this.config.jitter) : 0;
    const totalDelay = txDelay + propDelay + jitter;

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

      // Transmitter still takes txDelay to emit the dropped frame onto the channel
      this.sim.schedule(
        txDelay,
        () => this._processNext(isAck),
        [],
        `Tx done for dropped ${packet.type} seq=${packet.seq}`
      );
      return;
    }

    // 3. Check bit corruption
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

    // Schedule transmitter completion after txDelay to release the link for next queued frame
    this.sim.schedule(
      txDelay,
      () => this._processNext(isAck),
      [],
      `Tx done for ${packet.type} seq=${packet.seq}`
    );

    // Schedule arrival event after totalDelay (txDelay + propDelay + jitter)
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
