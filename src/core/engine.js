import { MinHeap, SimEvent } from './event.js';
import { SeededRNG } from './random.js';

/**
 * Discrete-Event Simulator Engine
 * Keeps a min-heap priority queue of future events, virtual clock, and seeded RNG.
 */
export class Simulator {
  constructor(seed = 42) {
    this.virtualClock = 0.0;
    this.eventHeap = new MinHeap();
    this.eventCounter = 0;
    this.rng = new SeededRNG(seed);
    this.isRunning = false;
  }

  get now() {
    return this.virtualClock;
  }

  /**
   * Schedule an event in the future.
   * @param {number} delay Relative time delay from now
   * @param {Function} fn Callback function to execute
   * @param {Array} args Arguments to pass to callback
   * @param {string} description Optional event label for logging/debugging
   * @returns {number} Event ID
   */
  schedule(delay, fn, args = [], description = '') {
    if (delay < 0) {
      throw new Error(`Cannot schedule event in the past (delay: ${delay})`);
    }
    const eventTime = this.virtualClock + delay;
    const eventId = ++this.eventCounter;
    const event = new SimEvent(eventId, eventTime, fn, args, description);
    this.eventHeap.push(event);
    return eventId;
  }

  /**
   * Run the simulation until the event queue is empty or until maxTime is reached.
   * @param {number|null} maxTime Optional max virtual time cap
   */
  run(maxTime = null) {
    this.isRunning = true;
    while (!this.eventHeap.isEmpty()) {
      const nextEvent = this.eventHeap.peek();
      if (maxTime !== null && nextEvent.time > maxTime) {
        break;
      }

      const event = this.eventHeap.pop();
      this.virtualClock = event.time;
      event.execute();
    }
    this.isRunning = false;
    return this.virtualClock;
  }

  /**
   * Execute a single step (one event).
   * @returns {boolean} True if an event was processed, false if queue was empty
   */
  step() {
    if (this.eventHeap.isEmpty()) return false;
    const event = this.eventHeap.pop();
    this.virtualClock = event.time;
    event.execute();
    return true;
  }

  /**
   * Reset simulation to initial state.
   */
  reset(seed = null) {
    this.virtualClock = 0.0;
    this.eventHeap = new MinHeap();
    this.eventCounter = 0;
    this.isRunning = false;
    if (seed !== null) {
      this.rng = new SeededRNG(seed);
    } else {
      this.rng.reset();
    }
  }
}
