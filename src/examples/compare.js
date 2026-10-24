import { compareProtocols, runSimulation } from '../experiments/runner.js';
import { ProtocolType } from '../core/config.js';

console.log('=== Sliding-Window Protocol Simulator Demo ===\n');

// 1. Run a sample Go-Back-N trace
console.log('1. Running Go-Back-N with 10% packet loss and event tracing:');
const gbn = runSimulation({
  protocol: ProtocolType.GO_BACK_N,
  numFrames: 10,
  senderWindow: 4,
  k: 3,
  lossRate: 0.1,
  seed: 42
}, true);

console.log(gbn.tracer.formatConsoleTrace(20));
console.log('\nGBN Summary:');
console.table(gbn.summary);

// 2. Compare Stop-and-Wait, Go-Back-N, and Selective Repeat under identical seed and loss
console.log('\n2. Comparative benchmark under identical loss & channel conditions:');
const comparison = compareProtocols({
  numFrames: 25,
  lossRate: 0.15,
  seed: 123
});
console.table(comparison);
