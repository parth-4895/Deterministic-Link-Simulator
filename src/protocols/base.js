import { RTOEstimator } from '../core/rto.js';

/**
 * ProtocolStrategy (Base Interface)
 * Adheres to Strategy Pattern. All sliding window protocols implement this contract.
 */
export class ProtocolStrategy {
  /**
   * @param {Object} options
   * @param {import('../core/engine.js').Simulator} options.simulator
   * @param {import('../core/config.js').SimulationConfig} options.config
   * @param {import('../channel/channel.js').Channel} options.channel
   * @param {import('../metrics/collector.js').MetricsCollector} options.metrics
   * @param {import('../metrics/tracer.js').EventTracer} options.tracer
   */
  constructor({ simulator, config, channel, metrics, tracer }) {
    this.sim = simulator;
    this.config = config;
    this.channel = channel;
    this.metrics = metrics;
    this.tracer = tracer;

    // Per-frame generation counter for lazy cancellation of timers
    this.timerGenerations = new Map();

    // Adaptive RTO tracking (Jacobson/Karels with Karn's algorithm)
    this.rtoEstimator = this.config.adaptiveRto ? new RTOEstimator(this.config.rttEstimate || 0.1) : null;
    this.packetSendTimes = new Map();     // absSeq -> send timestamp
    this.retransmittedPackets = new Set(); // absSeq set of retransmitted packets
  }

  /**
   * Record initial transmission for RTT sampling
   */
  recordSend(absSeq) {
    if (!this.retransmittedPackets.has(absSeq)) {
      this.packetSendTimes.set(absSeq, this.sim.now);
    }
  }

  /**
   * Record retransmission (Karn's algorithm ignores retransmitted samples)
   */
  recordRetransmit(absSeq) {
    this.retransmittedPackets.add(absSeq);
    this.packetSendTimes.delete(absSeq);
  }

  /**
   * Sample RTT on ACK arrival if packet was never retransmitted (Karn's rule)
   */
  sampleRttOnAck(absSeq) {
    if (this.rtoEstimator && this.packetSendTimes.has(absSeq)) {
      const sampleRtt = this.sim.now - this.packetSendTimes.get(absSeq);
      this.packetSendTimes.delete(absSeq);
      if (sampleRtt > 0) {
        this.config.rto = this.rtoEstimator.update(sampleRtt);
      }
    }
  }

  /**
   * Start frame timer with generation counter. Stale timers become harmless no-ops.
   */
  startTimer(seq, absSeq) {
    const nextGen = (this.timerGenerations.get(absSeq) || 0) + 1;
    this.timerGenerations.set(absSeq, nextGen);

    this.sim.schedule(
      this.config.rto,
      () => {
        // If generation still matches, timer is valid and hasn't been cancelled/renewed
        if (this.timerGenerations.get(absSeq) === nextGen) {
          this.onTimeout(seq, absSeq, nextGen);
        }
      },
      [],
      `Timer for frame abs=${absSeq}`
    );
  }

  /**
   * Stop timer for a frame
   */
  stopTimer(absSeq) {
    const current = this.timerGenerations.get(absSeq) || 0;
    this.timerGenerations.set(absSeq, current + 1);
  }

  /**
   * Called by application to submit data frames to send
   */
  onAppData(payload) {
    throw new Error('Method onAppData must be implemented');
  }

  /**
   * Called when a packet arrives at the receiver
   */
  onFrame(packet) {
    throw new Error('Method onFrame must be implemented');
  }

  /**
   * Called when an ACK arrives at the sender
   */
  onAck(ackPacket) {
    throw new Error('Method onAck must be implemented');
  }

  /**
   * Called when a timer expires
   */
  onTimeout(seq, absSeq, generation) {
    throw new Error('Method onTimeout must be implemented');
  }

  /**
   * Check if transfer of all frames is complete and acknowledged
   */
  isDone() {
    throw new Error('Method isDone must be implemented');
  }
}
