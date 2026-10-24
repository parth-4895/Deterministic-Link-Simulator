import fs from 'node:fs';
import { Command } from 'commander';
import Table from 'cli-table3';
import pc from 'picocolors';
import { runSimulation, compareProtocols } from './experiments/runner.js';
import { sweepWindowSize, sweepLossRate } from './experiments/sweeps.js';
import { renderBarChart, exportSvgSequenceDiagram } from './visualization/charts.js';

const program = new Command();

program
  .name('sliding-sim')
  .description('Deterministic Discrete-Event Sliding-Window Protocol Simulator')
  .version('1.0.0');

program
  .command('run')
  .description('Run a simulation for a specific protocol')
  .option('-p, --protocol <name>', 'STOP_AND_WAIT, GO_BACK_N, or SELECTIVE_REPEAT', 'GO_BACK_N')
  .option('-n, --frames <count>', 'Number of frames to transmit', '20')
  .option('-w, --window <size>', 'Sender window size W_s', '4')
  .option('-r, --rwindow <size>', 'Receiver window size W_r', '1')
  .option('-k, --bits <k>', 'Sequence number bits (modulo 2^k)', '3')
  .option('-l, --loss <rate>', 'Packet loss probability (0.0 to 1.0)', '0.05')
  .option('-a, --ack-loss <rate>', 'ACK loss probability', '0.0')
  .option('-c, --corrupt <rate>', 'CRC corruption probability', '0.0')
  .option('-s, --seed <number>', 'RNG seed', '42')
  .option('--fast-retransmit', 'Enable fast retransmit on 3 duplicate ACKs', false)
  .option('--nak', 'Enable Negative ACKs (NAK) for Selective Repeat', false)
  .option('--adaptive-rto', 'Enable Jacobson/Karels dynamic RTO estimation', false)
  .option('--trace', 'Show step-by-step event trace log', false)
  .action(options => {
    const res = runSimulation({
      protocol: options.protocol,
      numFrames: parseInt(options.frames, 10),
      senderWindow: parseInt(options.window, 10),
      receiverWindow: parseInt(options.rwindow, 10),
      k: parseInt(options.bits, 10),
      lossRate: parseFloat(options.loss),
      ackLossRate: parseFloat(options.ackLoss),
      corruptionRate: parseFloat(options.corrupt),
      seed: parseInt(options.seed, 10),
      fastRetransmit: Boolean(options.fastRetransmit),
      enableNak: Boolean(options.nak),
      adaptiveRto: Boolean(options.adaptiveRto)
    }, true);

    console.log(pc.bold(pc.cyan(`\n=== Simulation Run: ${options.protocol} ===`)));

    if (options.trace) {
      console.log(pc.yellow('\n--- Event Trace ---'));
      console.log(res.tracer.formatConsoleTrace());
    }

    const table = new Table({
      head: [pc.green('Metric'), pc.green('Value')]
    });

    const s = res.summary;
    table.push(
      ['Protocol', pc.bold(s.protocol)],
      ['Delivered Frames', `${s.delivered} / ${s.totalFrames}`],
      ['Total Transmissions', s.transmissions],
      ['Retransmissions', pc.yellow(s.retransmissions)],
      ['Retransmit Ratio', s.retransmitRatio],
      ['ACKs Sent', s.acksSent],
      ['Dropped Packets', pc.red(s.dropped)],
      ['Corrupted (CRC)', pc.red(s.corrupted)],
      ['Elapsed Virtual Time', s.virtualTime],
      ['Channel Utilization', pc.magenta(s.utilization)],
      ['Goodput', pc.blue(s.goodput)]
    );

    console.log('\n' + table.toString());
  });

program
  .command('compare')
  .description('Compare Stop-and-Wait, Go-Back-N, and Selective Repeat under identical conditions')
  .option('-n, --frames <count>', 'Number of frames to transmit', '30')
  .option('-l, --loss <rate>', 'Packet loss probability', '0.1')
  .option('-s, --seed <number>', 'RNG seed', '42')
  .action(options => {
    const results = compareProtocols({
      numFrames: parseInt(options.frames, 10),
      lossRate: parseFloat(options.loss),
      seed: parseInt(options.seed, 10)
    });

    console.log(pc.bold(pc.cyan(`\n=== Comparative Evaluation (Loss Rate: ${(parseFloat(options.loss) * 100).toFixed(0)}%, Seed: ${options.seed}) ===\n`)));

    const table = new Table({
      head: [
        pc.green('Protocol'),
        pc.green('Delivered'),
        pc.green('Tx / Retx'),
        pc.green('Retx Ratio'),
        pc.green('Dropped'),
        pc.green('Time (s)'),
        pc.green('Utilization'),
        pc.green('Goodput')
      ]
    });

    for (const r of results) {
      table.push([
        pc.bold(r.protocol),
        r.delivered,
        `${r.transmissions} / ${r.retransmissions}`,
        r.retransmitRatio,
        r.dropped,
        r.virtualTime,
        pc.magenta(r.utilization),
        pc.blue(r.goodput)
      ]);
    }

    console.log(table.toString());
  });

program
  .command('sweep-window')
  .description('Run window size sweep showing knee near W = 1 + 2a')
  .option('-m, --max <size>', 'Max window size', '10')
  .option('-p, --protocol <name>', 'Protocol to test (GO_BACK_N or SELECTIVE_REPEAT)', 'GO_BACK_N')
  .option('-n, --frames <count>', 'Number of frames', '20')
  .option('-s, --seed <number>', 'RNG seed', '42')
  .action(options => {
    const max = parseInt(options.max, 10);
    const data = sweepWindowSize({
      protocol: options.protocol,
      maxWindow: max,
      baseOptions: {
        numFrames: parseInt(options.frames, 10),
        seed: parseInt(options.seed, 10)
      }
    });

    console.log(pc.bold(pc.cyan(`\n=== Window Size Sweep: ${options.protocol} (W = 1..${max}) ===`)));
    if (data.theoreticalKnee) {
      console.log(pc.gray(`Parameter a = propDelay / txDelay ≈ ${data.a.toFixed(2)}`));
      console.log(pc.yellow(`Theoretical Optimal Window (Knee): W = 1 + 2a ≈ ${data.theoreticalKnee.toFixed(1)}\n`));
    }

    const table = new Table({
      head: [
        pc.green('Window Size (W_s)'),
        pc.green('Utilization (%)'),
        pc.green('Goodput (kbps)'),
        pc.green('Time (s)')
      ]
    });

    for (const d of data) {
      table.push([
        d.windowSize,
        pc.magenta(d.utilization + ' %'),
        pc.blue(d.goodput),
        d.virtualTime
      ]);
    }

    console.log(table.toString());

    console.log(pc.bold(pc.yellow('\n--- Channel Utilization Chart ---')));
    const chart = renderBarChart(
      data.map(d => ({ label: `W = ${d.windowSize}`, value: d.utilization })),
      { labelKey: 'label', valueKey: 'value', unit: '%' }
    );
    console.log(chart + '\n');
  });

program
  .command('sweep-loss')
  .description('Compare GBN vs SR retransmissions under rising loss rates')
  .option('-n, --frames <count>', 'Number of frames to transmit', '20')
  .option('-s, --seed <number>', 'RNG seed', '42')
  .action(options => {
    const lossRates = [0.0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
    const comparison = sweepLossRate({
      lossRates,
      baseOptions: {
        numFrames: parseInt(options.frames, 10),
        seed: parseInt(options.seed, 10)
      }
    });

    console.log(pc.bold(pc.cyan('\n=== Protocol Comparison Under Rising Loss Rate ===\n')));

    const table = new Table({
      head: [
        pc.green('Loss Rate'),
        pc.green('Protocol'),
        pc.green('Retx'),
        pc.green('Delivered'),
        pc.green('Utilization'),
        pc.green('Time (s)')
      ]
    });

    for (const row of comparison) {
      for (const r of row.results) {
        table.push([
          row.lossRate,
          pc.bold(r.protocol),
          pc.yellow(r.retransmissions),
          r.delivered,
          pc.magenta(r.utilization),
          r.virtualTime
        ]);
      }
      table.push([{ colSpan: 6, content: '' }]);
    }

    console.log(table.toString());
  });

program
  .command('diagram')
  .alias('mermaid')
  .description('Export a swim-lane sequence diagram (Mermaid or SVG) from simulation event trace')
  .option('-p, --protocol <name>', 'Protocol to use', 'GO_BACK_N')
  .option('-n, --frames <count>', 'Number of frames', '8')
  .option('-w, --window <size>', 'Sender window W_s', '4')
  .option('-l, --loss <rate>', 'Packet loss probability', '0.1')
  .option('-s, --seed <number>', 'RNG seed', '42')
  .option('-e, --events <count>', 'Max events in diagram', '40')
  .option('-f, --format <format>', 'Output format: mermaid or svg', 'mermaid')
  .option('-o, --output <path>', 'Optional file path to save diagram to')
  .action(options => {
    const res = runSimulation({
      protocol: options.protocol,
      numFrames: parseInt(options.frames, 10),
      senderWindow: parseInt(options.window, 10),
      lossRate: parseFloat(options.loss),
      seed: parseInt(options.seed, 10)
    }, true);

    const maxEvents = parseInt(options.events, 10);
    const format = options.format.toLowerCase();

    let outputContent = '';
    if (format === 'svg') {
      const eventsSlice = res.tracer.getTrace().slice(0, maxEvents);
      outputContent = exportSvgSequenceDiagram(eventsSlice);
      console.log(pc.bold(pc.cyan('\n=== SVG Sequence Diagram Generated ===\n')));
    } else {
      const diagram = res.tracer.exportMermaidDiagram(maxEvents);
      outputContent = `\`\`\`mermaid\n${diagram}\n\`\`\``;
      console.log(pc.bold(pc.cyan('\n=== Mermaid Sequence Diagram ===\n')));
      console.log(pc.yellow('Paste into https://mermaid.live or Markdown viewer:\n'));
    }

    console.log(outputContent);

    if (options.output) {
      fs.writeFileSync(options.output, outputContent, 'utf-8');
      console.log(pc.green(`\nDiagram successfully saved to: ${options.output}`));
    }
  });

program.parse(process.argv);
