/**
 * Jacobson/Karels Algorithm for Dynamic RTO Estimation (RFC 6298 / TCP)
 * 
 * When a non-retransmitted packet is acknowledged:
 *   SampleRTT = now - transmitTime
 *   RTTVAR = (1 - beta) * RTTVAR + beta * |SRTT - SampleRTT|  (beta = 0.25)
 *   SRTT   = (1 - alpha) * SRTT + alpha * SampleRTT          (alpha = 0.125)
 *   RTO    = SRTT + 4 * RTTVAR
 */
export class RTOEstimator {
  /**
   * @param {number} initialRtt - Initial RTT estimate in seconds
   * @param {number} minRto - Minimum RTO floor in seconds (default 0.05s)
   * @param {number} maxRto - Maximum RTO ceiling in seconds (default 60.0s)
   */
  constructor(initialRtt = 0.1, minRto = 0.05, maxRto = 60.0) {
    this.srtt = initialRtt;
    this.rttvar = initialRtt / 2;
    this.rto = Math.min(maxRto, Math.max(minRto, this.srtt + 4 * this.rttvar));
    this.minRto = minRto;
    this.maxRto = maxRto;
    this.samplesCount = 0;
  }

  /**
   * Updates RTO with a measured SampleRTT
   * @param {number} sampleRtt - Measured RTT in seconds
   * @returns {number} Updated RTO in seconds
   */
  update(sampleRtt) {
    if (this.samplesCount === 0) {
      // First measurement according to RFC 6298
      this.srtt = sampleRtt;
      this.rttvar = sampleRtt / 2;
    } else {
      const alpha = 0.125; // 1/8
      const beta = 0.25;   // 1/4
      this.rttvar = (1 - beta) * this.rttvar + beta * Math.abs(this.srtt - sampleRtt);
      this.srtt = (1 - alpha) * this.srtt + alpha * sampleRtt;
    }
    this.samplesCount++;
    this.rto = Math.min(this.maxRto, Math.max(this.minRto, this.srtt + 4 * this.rttvar));
    return this.rto;
  }
}
