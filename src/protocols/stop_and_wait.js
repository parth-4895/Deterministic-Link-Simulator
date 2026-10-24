import { ProtocolStrategy } from './base.js';
import { Packet, PacketType } from '../core/packet.js';

/**
 * Stop-and-Wait Protocol
 * Window size = 1. Sender transmits one frame and idles until ACK arrives or timeout fires.
 * Receiver expects 0 or 1 sequentially (modulo 2).
 */
export class StopAndWaitProtocol extends ProtocolStrategy {
  constructor(options) {
    super(options);

    // Sender state
    this.senderSeq = 0;             // Internal absolute sequence count
    this.currentFrame = null;       // Current outstanding frame
    this.isWaitingForAck = false;
    this.completedCount = 0;

    // Receiver state
    this.expectedAbsSeq = 0;
  }

  onAppData(payload) {
    if (this.isWaitingForAck) return false;

    const wireSeq = this.senderSeq % this.config.modulus;
    const packet = new Packet({
      seq: wireSeq,
      absSeq: this.senderSeq,
      type: PacketType.DATA,
      payload,
      size: this.config.packetSize
    });

    this.currentFrame = packet;
    this.isWaitingForAck = true;

    this.metrics.recordTransmit(packet, false);
    this.recordSend(this.senderSeq);
    this.startTimer(wireSeq, this.senderSeq);

    this.channel.transmit(packet, p => this.onFrame(p));
    return true;
  }

  onFrame(packet) {
    // Check CRC corruption
    if (!packet.isValid()) {
      return; // Discard corrupted frame
    }

    // Accept expected frame
    if (packet.absSeq === this.expectedAbsSeq) {
      this.metrics.recordDelivery(packet);
      this.expectedAbsSeq++;

      // Send ACK for this frame
      const ack = new Packet({
        seq: packet.seq,
        absSeq: packet.absSeq,
        type: PacketType.ACK,
        size: this.config.ackSize
      });
      this.metrics.recordAckSent(ack);
      this.channel.transmit(ack, a => this.onAck(a));
    } else if (packet.absSeq < this.expectedAbsSeq) {
      // Duplicate frame: re-send ACK so sender can advance
      const ack = new Packet({
        seq: packet.seq,
        absSeq: packet.absSeq,
        type: PacketType.ACK,
        size: this.config.ackSize
      });
      this.metrics.recordAckSent(ack);
      this.channel.transmit(ack, a => this.onAck(a));
    }
  }

  onAck(ackPacket) {
    if (!ackPacket.isValid()) return; // Discard corrupted ACK

    if (this.isWaitingForAck && ackPacket.absSeq === this.senderSeq) {
      this.sampleRttOnAck(ackPacket.absSeq);
      this.stopTimer(this.senderSeq);
      this.isWaitingForAck = false;
      this.currentFrame = null;
      this.senderSeq++;
      this.completedCount++;
    }
  }

  onTimeout(seq, absSeq, generation) {
    if (this.isWaitingForAck && absSeq === this.senderSeq && this.currentFrame) {
      if (this.tracer) {
        this.tracer.log({
          time: this.sim.now,
          type: 'TIMEOUT',
          packet: this.currentFrame
        });
      }

      this.recordRetransmit(absSeq);
      this.metrics.recordTransmit(this.currentFrame, true);
      this.startTimer(seq, absSeq);
      this.channel.transmit(this.currentFrame, p => this.onFrame(p));
    }
  }

  isDone() {
    return this.completedCount >= this.config.numFrames && !this.isWaitingForAck;
  }
}
