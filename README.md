# Sliding-Window Protocol Simulator (Node.js)

A deterministic discrete-event simulator (DES) comparing **Stop-and-Wait**, **Go-Back-N (GBN)**, and **Selective Repeat (SR)** over an unreliable channel, implemented in modern JavaScript (ES Modules).

---

## 📁 Project Architecture & Folder Structure

```
.
├── src/
│   ├── core/
│   │   ├── engine.js       # Discrete-Event Simulator engine with virtual clock
│   │   ├── event.js        # Min-Heap priority queue with deterministic tie-breaking
│   │   ├── random.js       # Seeded RNG (Mulberry32) for reproducible runs
│   │   ├── config.js       # SimulationConfig with 2^k window sizing validation
│   │   ├── packet.js       # Packet data class, PacketType, CRC-32 checksum
│   │   └── rto.js          # Jacobson/Karels dynamic RTO estimation (RFC 6298)
│   │
│   ├── channel/
│   │   └── channel.js      # Unreliable link: delay, bandwidth, random/scripted loss, jitter, bit corruption
│   │
│   ├── protocols/
│   │   ├── base.js             # ProtocolStrategy base interface, RTT sampling, lazy timer cancellation
│   │   ├── stop_and_wait.js    # Stop-and-Wait (W_s = 1, W_r = 1)
│   │   ├── go_back_n.js        # Go-Back-N (cumulative ACKs, Fast Retransmit on 3 dup ACKs)
│   │   └── selective_repeat.js # Selective Repeat (per-frame timers, re-ACK below window rule, NAK)
│   │
│   ├── metrics/
│   │   ├── collector.js    # Metric counters, channel utilization, goodput, retransmit ratio
│   │   └── tracer.js       # EventTracer, terminal logger, Mermaid sequence diagram generator
│   │
│   ├── visualization/
│   │   └── charts.js       # ASCII bar charts and SVG sequence diagram generator
│   │
│   ├── experiments/
│   │   ├── runner.js       # Single and comparative protocol runner
│   │   └── sweeps.js       # Window size sweep (W = 1 + 2a knee) and loss rate sweep
│   │
│   ├── cli.js              # Command Line Interface (Commander + cli-table3 + picocolors)
│   ├── index.js            # Module entry point exporting library components
│   │
│   └── examples/
│       └── compare.js      # Demo running GBN trace and comparative benchmark
│
├── tests/
│   └── simulator.test.js   # Automated unit and protocol test suite (Node Test Runner)
│
├── package.json
└── README.md
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Comparison Demo
```bash
npm run demo
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Use the CLI

```bash
# 1. Run a specific protocol with live event trace
node src/cli.js run --protocol GO_BACK_N --frames 15 --loss 0.1 --trace

# 2. Run with Phase 6 extensions (Fast Retransmit, NAK, Adaptive RTO)
node src/cli.js run --protocol GO_BACK_N --frames 20 --loss 0.1 --fast-retransmit --trace
node src/cli.js run --protocol SELECTIVE_REPEAT --frames 20 --loss 0.1 --nak --trace

# 3. Compare all 3 protocols under identical channel conditions and seed
node src/cli.js compare --frames 30 --loss 0.15

# 4. Sweep window size showing theoretical knee near W = 1 + 2a and ASCII chart
node src/cli.js sweep-window --max 8

# 5. Sweep packet loss rates comparing retransmission overhead (GBN vs SR)
node src/cli.js sweep-loss --frames 25

# 6. Export swim-lane sequence diagrams (Mermaid or SVG)
node src/cli.js diagram --protocol GO_BACK_N --format mermaid
node src/cli.js diagram --protocol SELECTIVE_REPEAT --format svg --output diagram.svg
```

---

## 🔬 Features & Mathematical Foundations

### 1. Discrete-Event Simulation (DES) Core
- **Virtual Clock & Min-Heap**: Jumps directly between discrete event timestamps with deterministic tie-breaking by event ID.
- **Seeded RNG (Mulberry32)**: Completely reproducible simulations regardless of execution environment.
- **Lazy Timer Cancellation**: Per-frame generation counter invalidates stale timers without expensive heap removals.

### 2. Channel Realism
- **Transmission Delay**: Computed as $(Size \times 8) / Bandwidth$.
- **Propagation Delay & Jitter**: Models distance and physical link latency variance.
- **CRC-32 Error Detection**: Frame corruption is detected by receiver checksum recomputation rather than simulated flags.
- **Scripted & Random Loss**: Test exact corner cases with `{ absSeq, attempt }` or stochastic loss.

### 3. Protocols Implemented
- **Stop-and-Wait**: Sender window $W_s = 1$, receiver window $W_r = 1$, idle-and-wait.
- **Go-Back-N**: Sender window $W_s$, cumulative ACKs, window retransmission on base timeout, Fast Retransmit on 3 duplicate ACKs.
- **Selective Repeat**: Sender window $W_s$, receiver window $W_r$, per-packet timers, re-ACK below window rule $[rcvBase - W_r, rcvBase - 1]$, and Negative ACKs (NAK) for out-of-order gap detection.
- **Window Size Constraint Validation**: Verifies $2^k \ge W_s + 1$ (GBN) and $2^k \ge W_s + W_r$ (SR).

### 4. Theoretical Analysis
- **Knee Phenomenon**: Link bandwidth is saturated when $W \ge 1 + 2a$, where $a = \frac{T_{prop}}{T_{tx}}$. The `sweep-window` command visualizes this knee effect in real time.
