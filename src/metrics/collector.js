/**
 * MetricsCollector
 * Inline statistics tracking:
 * - transmissions, retransmissions, delivered, dropped, corrupted, ACKs sent
 * - Link utilization and goodput
 * - Completion virtual time
 */
export class MetricsCollector {
  constructor(config) {
    this.config = config;
    this.startTime = 0.0;
    this.completionTime = 0.0;

    this.transmissions = 0;
    this.retransmissions = 0;
    this.acksSent = 0;
    this.droppedPackets = 0;
    this.corruptedPackets = 0;
    this.deliveredPackets = 0;

    this.totalDataBytesSent = 0;
    this.usefulDataBytesDelivered = 0;
    this.busyTime = 0.0; // Total time channel transmitter was actively transmitting bits
  }

  start(time = 0.0) {
    this.startTime = time;
  }

  recordTransmit(packet, isRetransmit = false) {
    this.transmissions++;
    if (isRetransmit) {
      this.retransmissions++;
    }
    this.totalDataBytesSent += packet.size;
    const txTime = (packet.size * 8) / this.config.bandwidth;
    this.busyTime += txTime;
  }

  recordAckSent(ackPacket) {
    this.acksSent++;
  }

  recordDrop(packet) {
    this.droppedPackets++;
  }

  recordCorruption(packet) {
    this.corruptedPackets++;
  }

  recordDelivery(packet) {
    this.deliveredPackets++;
    this.usefulDataBytesDelivered += packet.size;
  }

  finish(virtualTime) {
    this.completionTime = virtualTime;
  }

  /**
   * Utilization = busy transmission time / total elapsed virtual time
   */
  get utilization() {
    const elapsed = this.completionTime - this.startTime;
    if (elapsed <= 0) return 0;
    return Math.min(1.0, this.busyTime / elapsed);
  }

  /**
   * Goodput = useful bits delivered / elapsed virtual time (bits per second)
   */
  get goodput() {
    const elapsed = this.completionTime - this.startTime;
    if (elapsed <= 0) return 0;
    return (this.usefulDataBytesDelivered * 8) / elapsed;
  }

  /**
   * Retransmission Ratio = retransmissions / initial original frames
   */
  get retransmissionRatio() {
    return this.deliveredPackets > 0 ? this.retransmissions / this.deliveredPackets : 0;
  }

  getSummary() {
    return {
      protocol: this.config.protocol,
      totalFrames: this.config.numFrames,
      delivered: this.deliveredPackets,
      transmissions: this.transmissions,
      retransmissions: this.retransmissions,
      acksSent: this.acksSent,
      dropped: this.droppedPackets,
      corrupted: this.corruptedPackets,
      virtualTime: this.completionTime.toFixed(4) + ' s',
      utilization: (this.utilization * 100).toFixed(2) + ' %',
      goodput: (this.goodput / 1e3).toFixed(2) + ' kbps',
      retransmitRatio: this.retransmissionRatio.toFixed(3)
    };
  }
}
