/**
 * ASCII Chart and Diagram Utilities for Terminal Visualization
 */

/**
 * Generate an ASCII bar chart for terminal output
 */
export function renderBarChart(data, { labelKey = 'label', valueKey = 'value', unit = '', width = 30 } = {}) {
  const maxVal = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1e-6);
  const lines = [];

  for (const item of data) {
    const val = Number(item[valueKey]) || 0;
    const barLen = Math.round((val / maxVal) * width);
    const bar = '█'.repeat(barLen) + '░'.repeat(Math.max(0, width - barLen));
    const label = String(item[labelKey]).padEnd(16, ' ');
    lines.push(`${label} | ${bar} ${val} ${unit}`);
  }

  return lines.join('\n');
}

/**
 * Export SVG sequence diagram from trace
 */
export function exportSvgSequenceDiagram(events, { width = 600, height = null } = {}) {
  const rowHeight = 28;
  const computedHeight = height || Math.max(300, (events.length + 3) * rowHeight);
  const senderX = 120;
  const receiverX = 480;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${computedHeight}" width="100%" height="${computedHeight}">\n`;
  svg += `  <defs>\n`;
  svg += `    <marker id="arrow-green" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#22c55e" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="arrow-blue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />\n`;
  svg += `    </marker>\n`;
  svg += `    <marker id="arrow-rose" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">\n`;
  svg += `      <path d="M 0 1 L 10 5 L 0 9 z" fill="#f43f5e" />\n`;
  svg += `    </marker>\n`;
  svg += `  </defs>\n`;
  svg += `  <style>\n`;
  svg += `    text { font-family: monospace, sans-serif; font-size: 12px; fill: #e2e8f0; }\n`;
  svg += `    line { stroke-width: 2; }\n`;
  svg += `  </style>\n`;
  svg += `  <rect width="100%" height="100%" fill="#0f172a" />\n`;

  // Lifelines
  svg += `  <line x1="${senderX}" y1="40" x2="${senderX}" y2="${computedHeight - 20}" stroke="#38bdf8" stroke-dasharray="4" />\n`;
  svg += `  <line x1="${receiverX}" y1="40" x2="${receiverX}" y2="${computedHeight - 20}" stroke="#a855f7" stroke-dasharray="4" />\n`;
  svg += `  <text x="${senderX}" y="25" text-anchor="middle" font-weight="bold" fill="#38bdf8">Sender</text>\n`;
  svg += `  <text x="${receiverX}" y="25" text-anchor="middle" font-weight="bold" fill="#a855f7">Receiver</text>\n`;

  let y = 60;
  for (const e of events) {
    const seq = e.packet ? e.packet.seq : '';
    if (e.type === 'SEND_DATA') {
      svg += `  <line x1="${senderX}" y1="${y}" x2="${receiverX}" y2="${y + 15}" stroke="#22c55e" marker-end="url(#arrow-green)" />\n`;
      svg += `  <text x="${(senderX + receiverX) / 2}" y="${y + 10}" text-anchor="middle" fill="#86efac">DATA seq=${seq}</text>\n`;
      y += rowHeight;
    } else if (e.type === 'SEND_ACK') {
      const isNak = e.packet && e.packet.type === 'NAK';
      const color = isNak ? '#f43f5e' : '#38bdf8';
      const marker = isNak ? 'url(#arrow-rose)' : 'url(#arrow-blue)';
      const label = isNak ? `NAK seq=${seq}` : `ACK seq=${seq}`;
      svg += `  <line x1="${receiverX}" y1="${y}" x2="${senderX}" y2="${y + 15}" stroke="${color}" marker-end="${marker}" />\n`;
      svg += `  <text x="${(senderX + receiverX) / 2}" y="${y + 10}" text-anchor="middle" fill="${color}">${label}</text>\n`;
      y += rowHeight;
    } else if (e.type === 'DROP') {
      svg += `  <text x="${(senderX + receiverX) / 2}" y="${y + 5}" text-anchor="middle" fill="#ef4444">✕ [Packet Dropped]</text>\n`;
      y += rowHeight;
    } else if (e.type === 'TIMEOUT') {
      svg += `  <text x="${senderX - 10}" y="${y + 5}" text-anchor="end" fill="#f59e0b">⏱ Timeout seq=${seq}</text>\n`;
      y += rowHeight;
    } else if (e.type === 'FAST_RETX') {
      svg += `  <text x="${senderX - 10}" y="${y + 5}" text-anchor="end" fill="#38bdf8">⚡ Fast Retx seq=${seq}</text>\n`;
      y += rowHeight;
    } else if (e.type === 'RECV_NAK') {
      svg += `  <text x="${senderX - 10}" y="${y + 5}" text-anchor="end" fill="#f43f5e">⚠ Retx on NAK seq=${seq}</text>\n`;
      y += rowHeight;
    }
  }

  svg += `</svg>`;
  return svg;
}
