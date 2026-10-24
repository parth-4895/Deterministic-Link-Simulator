import { ProtocolStrategy } from './base.js';
import { Packet, PacketType } from '../core/packet.js';

/**
 * Go-Back-N Protocol (GBN)
 * - Sender window W_s, receiver window = 1.
 * - Receiver accepts only next in-order frame and sends cumulative ACK.
 * - On timeout of window base, sender resends all unacknowledged frames in window.
 */
export class GoBackNProtocol extends ProtocolStrategy {
  constructor(options) {
    super(options);

    // Sender state
    this.base = 0;              // Window base (lowest unacked frame)
    this.nextSeqNum = 0;        // Next frame sequence to send
    this.buffer = new Map();    // absSeq -> Packet
    this.timerAbsSeq = null;    // Timer is active for the base packet

    // Receiver state
    this.expectedAbsSeq = 0;

    // Fast Retransmit state (Phase 6 extension)
    this.dupAckCount = 0;
  }

  sendAvailable() {
    while (
      this.nextSeqNum < this.base + this.config.senderWindow &&
      this.nextSeqNum < this.config.numFrames
    ) {
      const absSeq = this.nextSeqNum;
      const wireSeq = absSeq % this.config.modulus;
      const packet = new Packet({
        seq: wireSeq,
        absSeq,
        type: PacketType.DATA,
        payload: `Frame-${absSeq}`,
        size: this.config.packetSize
      });

      this.buffer.set(absSeq, packet);
      this.metrics.recordTransmit(packet, false);
      this.recordSend(absSeq);

      // Start timer if sending the base frame
      if (this.base === this.nextSeqNum) {
        this.timerAbsSeq = this.base;
        this.startTimer(wireSeq, this.base);
      }

      this.channel.transmit(packet, p => this.onFrame(p));
      this.nextSeqNum++;
    }
  }

  onAppData() {
    this.sendAvailable();
  }

  onFrame(packet) {
    if (!packet.isValid()) {
      return; // Discard corrupted packet
    }

    if (packet.absSeq === this.expectedAbsSeq) {
      this.metrics.recordDelivery(packet);
      this.expectedAbsSeq++;

      // Send cumulative ACK for this accepted frame
      const ack = new Packet({
        seq: packet.seq,
        absSeq: packet.absSeq,
        type: PacketType.ACK,
        size: this.config.ackSize
      });
      this.metrics.recordAckSent(ack);
      this.channel.transmit(ack, a => this.onAck(a));
    } else {
      // Out of order frame: resend cumulative ACK for highest in-order frame accepted
      if (this.expectedAbsSeq > 0) {
        const lastAckedAbs = this.expectedAbsSeq - 1;
        const ack = new Packet({
          seq: lastAckedAbs % this.config.modulus,
          absSeq: lastAckedAbs,
          type: PacketType.ACK,
          size: this.config.ackSize
        });
        this.metrics.recordAckSent(ack);
        this.channel.transmit(ack, a => this.onAck(a));
      }
    }
  }

  onAck(ackPacket) {
    if (!ackPacket.isValid()) return;

    // Cumulative ACK: acknowledges all frames up to and including ackPacket.absSeq
    if (ackPacket.absSeq >= this.base) {
      this.dupAckCount = 0;
      this.sampleRttOnAck(ackPacket.absSeq);

      const oldBase = this.base;
      this.base = ackPacket.absSeq + 1;

      // Clean up acknowledged frames from buffer
      for (let seq = oldBase; seq < this.base; seq++) {
        this.buffer.delete(seq);
      }

      // If there are still frames in flight, restart timer for new base; else stop timer
      if (this.base === this.nextSeqNum) {
        this.stopTimer(this.timerAbsSeq);
        this.timerAbsSeq = null;
      } else {
        this.stopTimer(this.timerAbsSeq);
        this.timerAbsSeq = this.base;
        this.startTimer(this.base % this.config.modulus, this.base);
      }

      // Window slid forward, send any new packets that now fit in window
      this.sendAvailable();
    } else if (ackPacket.absSeq === this.base - 1) {
      // Duplicate ACK received
      this.dupAckCount++;
      if (this.config.fastRetransmit && this.dupAckCount === 3) {
        // Fast Retransmit after 3 duplicate ACKs without waiting for RTO
        const basePacket = this.buffer.get(this.base);
        if (basePacket) {
          if (this.tracer) {
            this.tracer.log({
              time: this.sim.now,
              type: 'FAST_RETX',
              packet: basePacket,
              reason: '3 duplicate ACKs'
            });
          }
          this.recordRetransmit(this.base);
          this.metrics.recordTransmit(basePacket, true);
          this.startTimer(basePacket.seq, this.base);
          this.channel.transmit(basePacket, p => this.onFrame(p));
          this.dupAckCount = 0;
        }
      }
    }
  }

  onTimeout(seq, absSeq, generation) {
    if (this.base === absSeq && this.buffer.has(this.base)) {
      if (this.tracer) {
        this.tracer.log({
          time: this.sim.now,
          type: 'TIMEOUT',
          packet: this.buffer.get(this.base)
        });
      }

      // Go back to base and retransmit all unacknowledged packets currently in flight
      this.startTimer(seq, this.base);
      for (let s = this.base; s < this.nextSeqNum; s++) {
        const p = this.buffer.get(s);
        if (p) {
          this.recordRetransmit(s);
          this.metrics.recordTransmit(p, true);
          this.channel.transmit(p, frame => this.onFrame(frame));
        }
      }
    }
  }

  isDone() {
    return this.base >= this.config.numFrames;
  }
}
