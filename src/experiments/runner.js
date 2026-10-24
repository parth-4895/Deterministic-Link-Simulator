import { Simulator } from '../core/engine.js';
import { SimulationConfig, ProtocolType } from '../core/config.js';
import { Channel } from '../channel/channel.js';
import { MetricsCollector } from '../metrics/collector.js';
import { EventTracer } from '../metrics/tracer.js';
import { StopAndWaitProtocol } from '../protocols/stop_and_wait.js';
import { GoBackNProtocol } from '../protocols/go_back_n.js';
import { SelectiveRepeatProtocol } from '../protocols/selective_repeat.js';

/**
 * Runs a single simulation instance with the given configuration
 */
export function runSimulation(configOptions, enableTracer = true) {
  const config = new SimulationConfig(configOptions);
  const simulator = new Simulator(config.seed);
  const metrics = new MetricsCollector(config);
  const tracer = new EventTracer(enableTracer);

  const channel = new Channel({ simulator, config, metrics, tracer });

  let protocol;
  const protocolArgs = { simulator, config, channel, metrics, tracer };

  switch (config.protocol) {
    case ProtocolType.STOP_AND_WAIT:
      protocol = new StopAndWaitProtocol(protocolArgs);
      break;
    case ProtocolType.GO_BACK_N:
      protocol = new GoBackNProtocol(protocolArgs);
      break;
    case ProtocolType.SELECTIVE_REPEAT:
      protocol = new SelectiveRepeatProtocol(protocolArgs);
      break;
    default:
      throw new Error(`Unsupported protocol: ${config.protocol}`);
  }

  metrics.start(0.0);

  // Trigger initial application data transfer
  if (config.protocol === ProtocolType.STOP_AND_WAIT) {
    // Event-driven: SAW sends frames one by one, each triggered immediately after previous ACK.
    // We inject a `onFrameAcknowledged` callback into the protocol that schedules the next send.
    let nextAbsSeq = 0;
    const sendNextFrame = () => {
      if (nextAbsSeq < config.numFrames) {
        const seq = nextAbsSeq++;
        protocol.onAppData(`Frame-${seq}`);
      }
    };
    // Patch onAck to chain next frame (zero-delay, no polling)
    const origOnAck = protocol.onAck.bind(protocol);
    protocol.onAck = (ackPacket) => {
      origOnAck(ackPacket);
      // After ACK processed, if sender is now free, schedule next frame immediately
      if (!protocol.isWaitingForAck && nextAbsSeq < config.numFrames) {
        simulator.schedule(0, sendNextFrame, [], 'SAW next frame');
      }
    };
    sendNextFrame(); // Kick off first frame
  } else {
    protocol.onAppData();
  }

  // Run simulation until done or max time safety
  simulator.run(1000.0);
  metrics.finish(simulator.now);

  return {
    config,
    simulator,
    metrics,
    tracer,
    summary: metrics.getSummary()
  };
}

/**
 * Run identical benchmark comparing Stop-and-Wait, Go-Back-N, and Selective Repeat
 */
export function compareProtocols(baseOptions = {}) {
  const protocols = [
    { name: 'Stop-and-Wait', type: ProtocolType.STOP_AND_WAIT, W_s: 1, W_r: 1, k: 3 },
    { name: 'Go-Back-N', type: ProtocolType.GO_BACK_N, W_s: 4, W_r: 1, k: 3 },
    { name: 'Selective Repeat', type: ProtocolType.SELECTIVE_REPEAT, W_s: 4, W_r: 4, k: 3 }
  ];

  const results = [];

  for (const p of protocols) {
    const opts = {
      ...baseOptions,
      protocol: p.type,
      senderWindow: p.W_s,
      receiverWindow: p.W_r,
      k: p.k
    };
    const res = runSimulation(opts, false);
    results.push({
      protocol: p.name,
      ...res.summary
    });
  }

  return results;
}
