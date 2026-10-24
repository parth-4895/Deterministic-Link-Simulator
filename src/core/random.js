/**
 * Seeded Pseudo-Random Number Generator using Mulberry32 algorithm.
 * Guarantees 100% deterministic, reproducible simulation runs across runs and platforms.
 */
export class SeededRNG {
  constructor(seed = 42) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /**
   * Returns a float in [0, 1)
   */
  next() {
    let t = (this.state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a float in [min, max)
   */
  uniform(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  /**
   * Returns true with given probability p in [0, 1]
   */
  chance(p) {
    return this.next() < p;
  }

  /**
   * Resets the RNG back to initial seed
   */
  reset() {
    this.state = this.seed;
  }
}
