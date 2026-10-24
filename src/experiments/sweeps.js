import { compareProtocols } from './runner.js';
import { runSimulation } from './runner.js';
import { ProtocolType } from '../core/config.js';

/**
 * Sweeps sender window size W_s from 1 to maxWindow.
 * Demonstrates the knee near W = 1 + 2a (where a = propDelay / txDelay).
 */
export function sweepWindowSize({
  protocol = ProtocolType.GO_BACK_N,
  maxWindow = 10,
  baseOptions = {}
} = {}) {
  const points = [];
  const pktSize = baseOptions.packetSize || 1024;
  const bw = baseOptions.bandwidth || 1e6;
  const prop = baseOptions.propagationDelay !== undefined ? baseOptions.propagationDelay : 0.05;
  const txDelay = (pktSize * 8) / bw;
  const a = txDelay > 0 ? prop / txDelay : 0;
  const theoreticalKnee = 1 + 2 * a;

  for (let w = 1; w <= maxWindow; w++) {
    // For GBN 2^k >= w + 1; for SR 2^k >= 2*w
    const k = Math.ceil(Math.log2(w * 2 + 2));
    const opts = {
      ...baseOptions,
      protocol,
      senderWindow: w,
      receiverWindow: protocol === ProtocolType.SELECTIVE_REPEAT ? w : 1,
      k: Math.max(3, k)
    };

    const res = runSimulation(opts, false);
    points.push({
      windowSize: w,
      utilization: (res.metrics.utilization * 100).toFixed(2),
      goodput: (res.metrics.goodput / 1e3).toFixed(2),
      virtualTime: res.metrics.completionTime.toFixed(4)
    });
  }

  points.a = a;
  points.theoreticalKnee = theoreticalKnee;
  return points;
}

/**
 * Sweeps loss rates from 0% to maxLoss to compare GBN vs SR retransmissions
 */
export function sweepLossRate({
  lossRates = [0.0, 0.05, 0.1, 0.15, 0.2, 0.25],
  baseOptions = {}
} = {}) {
  const comparison = [];

  for (const loss of lossRates) {
    const res = compareProtocols({
      ...baseOptions,
      lossRate: loss
    });
    comparison.push({
      lossRate: `${(loss * 100).toFixed(0)}%`,
      results: res
    });
  }

  return comparison;
}
