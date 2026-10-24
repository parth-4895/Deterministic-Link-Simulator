import { ProtocolStrategy } from './base.js';
import { Packet, PacketType } from '../core/packet.js';

/**
 * Selective Repeat Protocol (SR)
 * - Sender window W_s, receiver window W_r.
 * - Receiver buffers frames inside its window and individually ACKs them.
 * - Critical rule from doc: Receiver also re-ACKs frames just below its window
 *   (already delivered in [rcv_base - W_r, rcv_base - 1]), so a lost ACK cannot stall sender.
 * - Each frame has its own independent timer; only expired frames are resent.
 */
export class SelectiveRepeatProtocol extends ProtocolStrategy {
  constructor(options) {
    super(options);

    // Sender state
    this.sendBase = 0;
    this.nextSeqNum = 0;
    this.sendBuffer = new Map();  // absSeq -> { packet, acked: boolean }

    // Receiver state
    this.rcvBase = 0;
    this.rcvBuffer = new Map();   // absSeq -> packet
    this.naksSent = new Set();    // Track sent NAKs to prevent spamming
  }

  sendAvailable() {
    while (
      this.nextSeqNum < this.sendBase + this.config.senderWindow &&
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

      this.sendBuffer.set(absSeq, { packet, acked: false });
      this.metrics.recordTransmit(packet, false);
      this.recordSend(absSeq);
      this.startTimer(wireSeq, absSeq);

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

    const { absSeq } = packet;

    // Case 1: Frame falls within receiver window [rcvBase, rcvBase + W_r - 1]
    if (absSeq >= this.rcvBase && absSeq < this.rcvBase + this.config.receiverWindow) {
      // Check for gap to send Negative ACK (NAK) if enabled
      if (this.config.enableNak && absSeq > this.rcvBase) {
        for (let s = this.rcvBase; s < absSeq; s++) {
          if (!this.rcvBuffer.has(s) && !this.naksSent.has(s)) {
            this.naksSent.add(s);
            const nak = new Packet({
              seq: s % this.config.modulus,
              absSeq: s,
              type: PacketType.NAK,
              size: this.config.ackSize
            });
            this.metrics.recordAckSent(nak);
            this.channel.transmit(nak, a => this.onAck(a));
          }
        }
      }

      // Send individual ACK
      const ack = new Packet({
        seq: packet.seq,
        absSeq,
        type: PacketType.ACK,
        size: this.config.ackSize
      });
      this.metrics.recordAckSent(ack);
      this.channel.transmit(ack, a => this.onAck(a));

      // Buffer packet if not already received
      if (!this.rcvBuffer.has(absSeq)) {
        this.rcvBuffer.set(absSeq, packet);
      }

      // If this frame was at the base, slide the window and deliver in-order packets
      if (absSeq === this.rcvBase) {
        while (this.rcvBuffer.has(this.rcvBase)) {
          const deliverPkt = this.rcvBuffer.get(this.rcvBase);
          this.rcvBuffer.delete(this.rcvBase);
          this.naksSent.delete(this.rcvBase);
          this.metrics.recordDelivery(deliverPkt);
          this.rcvBase++;
        }
      }
    }
    // Case 2: Frame falls just below receiver window [rcvBase - W_r, rcvBase - 1]
    // Re-ACK must be generated to prevent sender deadlock if previous ACK was lost
    else if (absSeq >= Math.max(0, this.rcvBase - this.config.receiverWindow) && absSeq < this.rcvBase) {
      const ack = new Packet({
        seq: packet.seq,
        absSeq,
        type: PacketType.ACK,
        size: this.config.ackSize
      });
      this.metrics.recordAckSent(ack);
      this.channel.transmit(ack, a => this.onAck(a));
    }
  }

  onAck(ackPacket) {
    if (!ackPacket.isValid()) return;

    const { absSeq } = ackPacket;

    // Handle Negative ACK (NAK) for immediate retransmission
    if (ackPacket.type === PacketType.NAK) {
      const entry = this.sendBuffer.get(absSeq);
      if (entry && !entry.acked) {
        if (this.tracer) {
          this.tracer.log({
            time: this.sim.now,
            type: 'RECV_NAK',
            packet: entry.packet,
            reason: 'Receiver requested immediate retransmission'
          });
        }
        this.recordRetransmit(absSeq);
        this.metrics.recordTransmit(entry.packet, true);
        this.startTimer(entry.packet.seq, absSeq);
        this.channel.transmit(entry.packet, p => this.onFrame(p));
      }
      return;
    }

    // If ACK is within sender window
    if (absSeq >= this.sendBase && absSeq < this.sendBase + this.config.senderWindow) {
      const entry = this.sendBuffer.get(absSeq);
      if (entry && !entry.acked) {
        entry.acked = true;
        this.stopTimer(absSeq);
        this.sampleRttOnAck(absSeq);

        // Advance sender window base if base frame is acknowledged
        while (this.sendBuffer.has(this.sendBase) && this.sendBuffer.get(this.sendBase).acked) {
          this.sendBuffer.delete(this.sendBase);
          this.sendBase++;
        }

        // Send newly eligible packets
        this.sendAvailable();
      }
    }
  }

  onTimeout(seq, absSeq, generation) {
    const entry = this.sendBuffer.get(absSeq);
    // Only retransmit if this specific packet has not been acknowledged
    if (entry && !entry.acked) {
      if (this.tracer) {
        this.tracer.log({
          time: this.sim.now,
          type: 'TIMEOUT',
          packet: entry.packet
        });
      }

      this.recordRetransmit(absSeq);
      this.metrics.recordTransmit(entry.packet, true);
      this.startTimer(seq, absSeq);
      this.channel.transmit(entry.packet, p => this.onFrame(p));
    }
  }

  isDone() {
    return this.sendBase >= this.config.numFrames;
  }
}
