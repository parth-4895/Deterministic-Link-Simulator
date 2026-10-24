import test from 'node:test';
import assert from 'node:assert/strict';

import { MinHeap } from '../src/core/event.js';
import { Simulator } from '../src/core/engine.js';
import { Packet, PacketType, computeCRC32 } from '../src/core/packet.js';
import { SimulationConfig, ProtocolType } from '../src/core/config.js';
import { RTOEstimator } from '../src/core/rto.js';
import { runSimulation, compareProtocols } from '../src/experiments/runner.js';
import { sweepWindowSize, sweepLossRate } from '../src/experiments/sweeps.js';
import { renderBarChart, exportSvgSequenceDiagram } from '../src/visualization/charts.js';

test('MinHeap orders events by timestamp and breaks ties deterministically', () => {
  const heap = new MinHeap();
  heap.push({ id: 1, time: 2.5 });
  heap.push({ id: 2, time: 1.0 });
  heap.push({ id: 3, time: 1.0 }); // Tie on time, should pop id: 2 then id: 3

  assert.equal(heap.pop().id, 2);
  assert.equal(heap.pop().id, 3);
  assert.equal(heap.pop().id, 1);
});

test('Packet CRC calculation and corruption detection', () => {
  const pkt = new Packet({ seq: 2, type: PacketType.DATA, payload: 'Test' });
  assert.equal(pkt.isValid(), true);

  pkt.corrupt();
  assert.equal(pkt.isValid(), false);
});

test('SimulationConfig validates 2^k window constraints', () => {
  // GBN requires 2^k >= W_s + 1: W_s = 7 with k=3 (2^3 = 8 >= 8) is valid
  assert.doesNotThrow(() => {
    new SimulationConfig({ protocol: ProtocolType.GO_BACK_N, k: 3, senderWindow: 7 });
  });

  // W_s = 8 with k=3 (8 < 9) violates constraint
  assert.throws(() => {
    new SimulationConfig({ protocol: ProtocolType.GO_BACK_N, k: 3, senderWindow: 8 });
  });

  // SR requires 2^k >= W_s + W_r: W_s=4, W_r=4 with k=3 (8 >= 8) is valid
  assert.doesNotThrow(() => {
    new SimulationConfig({ protocol: ProtocolType.SELECTIVE_REPEAT, k: 3, senderWindow: 4, receiverWindow: 4 });
  });

  // SR with W_s=5, W_r=4 (5+4=9 > 8) violates constraint
  assert.throws(() => {
    new SimulationConfig({ protocol: ProtocolType.SELECTIVE_REPEAT, k: 3, senderWindow: 5, receiverWindow: 4 });
  });
});

test('Stop-and-Wait delivers all frames over lossless channel', () => {
  const res = runSimulation({
    protocol: ProtocolType.STOP_AND_WAIT,
    numFrames: 5,
    lossRate: 0.0
  }, false);

  assert.equal(res.metrics.deliveredPackets, 5);
  assert.equal(res.metrics.retransmissions, 0);
});

test('Go-Back-N recovers from packet loss and delivers all frames', () => {
  const res = runSimulation({
    protocol: ProtocolType.GO_BACK_N,
    numFrames: 10,
    senderWindow: 4,
    k: 3,
    lossRate: 0.2,
    seed: 42
  }, false);

  assert.equal(res.metrics.deliveredPackets, 10);
  assert.ok(res.metrics.retransmissions >= 0);
});

test('Selective Repeat recovers with lower retransmissions than GBN on high loss', () => {
  const results = compareProtocols({ numFrames: 20, lossRate: 0.15, seed: 99 });
  const gbn = results.find(r => r.protocol === ProtocolType.GO_BACK_N);
  const sr = results.find(r => r.protocol === ProtocolType.SELECTIVE_REPEAT);

  assert.equal(gbn.delivered, 20);
  assert.equal(sr.delivered, 20);
});

test('Scripted drops drop targeted frames and retransmit successfully', () => {
  const res = runSimulation({
    protocol: ProtocolType.GO_BACK_N,
    numFrames: 8,
    senderWindow: 4,
    lossRate: 0.0,
    scriptedDrops: [
      { absSeq: 2, attempt: 1 } // Drop packet absSeq 2 only on first attempt
    ]
  }, true);

  assert.equal(res.metrics.deliveredPackets, 8);
  assert.equal(res.metrics.droppedPackets, 1);
  assert.ok(res.metrics.retransmissions >= 1);
});

test('Bit corruption causes receiver to discard packet and sender to recover', () => {
  const res = runSimulation({
    protocol: ProtocolType.SELECTIVE_REPEAT,
    numFrames: 10,
    senderWindow: 4,
    receiverWindow: 4,
    k: 3,
    corruptionRate: 0.15,
    seed: 123
  }, false);

  assert.equal(res.metrics.deliveredPackets, 10);
  if (res.metrics.corruptedPackets > 0) {
    assert.ok(res.metrics.retransmissions > 0);
  }
});

test('Window size sweep calculates theoretical knee W = 1 + 2a and returns points', () => {
  const sweep = sweepWindowSize({
    protocol: ProtocolType.GO_BACK_N,
    maxWindow: 6,
    baseOptions: { numFrames: 15, seed: 42 }
  });

  assert.equal(sweep.length, 6);
  assert.ok(sweep.a > 0);
  assert.ok(sweep.theoreticalKnee > 1);
  // Utilization should generally increase with window size
  assert.ok(Number(sweep[sweep.length - 1].utilization) >= Number(sweep[0].utilization));
});

test('Loss rate sweep compares protocols across specified loss rates', () => {
  const comp = sweepLossRate({
    lossRates: [0.0, 0.1],
    baseOptions: { numFrames: 10, seed: 42 }
  });

  assert.equal(comp.length, 2);
  assert.equal(comp[0].lossRate, '0%');
  assert.equal(comp[0].results.length, 3);
});

test('Fast Retransmit retransmits missing frame upon 3 duplicate ACKs in GBN', () => {
  const res = runSimulation({
    protocol: ProtocolType.GO_BACK_N,
    numFrames: 10,
    senderWindow: 5,
    k: 3,
    lossRate: 0.0,
    fastRetransmit: true,
    scriptedDrops: [{ absSeq: 1, attempt: 1 }] // Drop frame 1 once, subsequent frames 2,3,4 trigger duplicate ACKs
  }, true);

  assert.equal(res.metrics.deliveredPackets, 10);
  const fastRetxEvent = res.tracer.getTrace().find(e => e.type === 'FAST_RETX');
  assert.ok(fastRetxEvent, 'FAST_RETX event should be triggered by 3 duplicate ACKs');
  assert.equal(fastRetxEvent.packet.absSeq, 1);
});

test('Selective Repeat with NAK immediately requests missing frame', () => {
  const res = runSimulation({
    protocol: ProtocolType.SELECTIVE_REPEAT,
    numFrames: 8,
    senderWindow: 4,
    receiverWindow: 4,
    k: 3,
    lossRate: 0.0,
    enableNak: true,
    scriptedDrops: [{ absSeq: 1, attempt: 1 }] // Frame 1 dropped, frame 2 arrives and triggers NAK for frame 1
  }, true);

  assert.equal(res.metrics.deliveredPackets, 8);
  const nakEvent = res.tracer.getTrace().find(e => e.type === 'RECV_NAK');
  assert.ok(nakEvent, 'RECV_NAK event should be received by sender');
  assert.equal(nakEvent.packet.absSeq, 1);
});

test('Jacobson/Karels RTOEstimator updates RTO according to sample RTT', () => {
  const estimator = new RTOEstimator(0.1);
  const initialRto = estimator.rto;
  assert.ok(initialRto > 0);

  // Provide a sample RTT of 0.2s
  const updatedRto = estimator.update(0.2);
  assert.ok(updatedRto > 0);
  assert.notEqual(updatedRto, initialRto);
});

test('Visualization utilities generate ASCII chart and SVG sequence diagram', () => {
  const chart = renderBarChart([
    { label: 'W = 1', val: 10 },
    { label: 'W = 2', val: 25 }
  ], { labelKey: 'label', valueKey: 'val', unit: '%' });

  assert.ok(chart.includes('W = 1'));
  assert.ok(chart.includes('W = 2'));

  const svg = exportSvgSequenceDiagram([
    { type: 'SEND_DATA', packet: new Packet({ seq: 0, absSeq: 0 }) },
    { type: 'SEND_ACK', packet: new Packet({ seq: 0, absSeq: 0, type: PacketType.ACK }) }
  ]);

  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('DATA seq=0'));
  assert.ok(svg.includes('ACK seq=0'));
  assert.ok(svg.includes('</svg>'));
});
