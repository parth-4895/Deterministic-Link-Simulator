/**
 * EventTracer logs timestamped protocol events for debugging,
 * step-by-step trace output, and swim-lane (sequence) diagram visualization.
 */
export class EventTracer {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.events = [];
  }

  log(entry) {
    if (!this.enabled) return;
    const record = {
      id: this.events.length + 1,
      ...entry
    };
    this.events.push(record);
  }

  getTrace() {
    return this.events;
  }

  clear() {
    this.events = [];
  }

  /**
   * Format text log for terminal display
   */
  formatConsoleTrace(maxLines = null) {
    const slice = (maxLines && maxLines > 0) ? this.events.slice(-maxLines) : this.events;
    const lines = slice.map(e => {
      const timeStr = e.time.toFixed(4).padStart(8, ' ');
      const typeStr = e.type.padEnd(12, ' ');
      const desc = e.packet ? `${e.packet.toString()} [${e.direction || ''}]` : (e.description || '');
      const extra = e.reason ? ` (${e.reason})` : (e.corrupted ? ' [CRC_ERROR]' : '');
      return `[t=${timeStr}s] ${typeStr} : ${desc}${extra}`;
    });
    return lines.join('\n');
  }

  /**
   * Export sequence diagram formatted in Mermaid markdown
   */
  exportMermaidDiagram(maxEvents = 40) {
    const lines = ['sequenceDiagram', '  autonumber', '  participant S as Sender', '  participant C as Channel', '  participant R as Receiver'];
    const slice = this.events.slice(0, maxEvents);

    for (const e of slice) {
      const seq = e.packet ? e.packet.seq : '';
      if (e.type === 'SEND_DATA') {
        lines.push(`  S->>C: DATA (seq=${seq})`);
      } else if (e.type === 'RECV_DATA') {
        if (e.packet && !e.packet.isValid()) {
          lines.push(`  C--xR: DATA (seq=${seq}) [Corrupted CRC]`);
        } else {
          lines.push(`  C->>R: DATA (seq=${seq})`);
        }
      } else if (e.type === 'SEND_ACK') {
        const ackType = e.packet && e.packet.type === 'NAK' ? 'NAK' : 'ACK';
        lines.push(`  R->>C: ${ackType} (seq=${seq})`);
      } else if (e.type === 'RECV_ACK') {
        const ackType = e.packet && e.packet.type === 'NAK' ? 'NAK' : 'ACK';
        lines.push(`  C->>S: ${ackType} (seq=${seq})`);
      } else if (e.type === 'DROP') {
        lines.push(`  Note over C: Packet dropped (${e.reason || 'loss'})`);
      } else if (e.type === 'TIMEOUT') {
        lines.push(`  Note over S: Timeout! (seq=${seq})`);
      } else if (e.type === 'FAST_RETX') {
        lines.push(`  Note over S: Fast Retransmit (seq=${seq}) [3 dup ACKs]`);
      } else if (e.type === 'RECV_NAK') {
        lines.push(`  Note over S: Immediate Retransmit (seq=${seq}) [NAK]`);
      }
    }
    return lines.join('\n');
  }
}
