/**
 * Load Testing Framework
 *
 * Simulate realistic load patterns:
 * - Constant load
 * - Ramp-up load
 * - Spike load
 * - Wave load (periodic)
 *
 * Metrics collection and analysis
 */

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

/**
 * Load test metrics
 */
export interface LoadTestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalDuration: number; // ms
  minResponseTime: number;
  maxResponseTime: number;
  avgResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  errorRate: number; // 0-1
  errors: Map<string, number>; // Error type -> count
}

/**
 * Response sample for analysis
 */
interface ResponseSample {
  duration: number;
  statusCode: number;
  error?: string;
  timestamp: number;
}

/**
 * Load testing scenario
 */
export interface LoadTestScenario {
  name: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: any;
  headers?: Record<string, string>;
  timeout?: number; // ms
}

/**
 * Load pattern
 */
export interface LoadPattern {
  type: 'constant' | 'ramp' | 'spike' | 'wave';
  startRPS: number; // Requests per second
  endRPS?: number; // For ramp
  peakRPS?: number; // For spike/wave
  durationSeconds: number;
  spikeDurationSeconds?: number;
  wavePeriodSeconds?: number;
}

/**
 * Load test configuration
 */
export interface LoadTestConfig {
  baseURL: string;
  scenarios: LoadTestScenario[];
  pattern: LoadPattern;
  rampUpTime?: number; // seconds
  warmupRequests?: number; // Requests to run before measuring
  concurrency?: number; // Max concurrent requests
  timeout?: number; // Request timeout in ms
}

/**
 * Load test executor
 */
export class LoadTester {
  private client: AxiosInstance;
  private samples: ResponseSample[] = [];
  private running: boolean = false;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      validateStatus: () => true, // Don't throw on any status code
    });
  }

  /**
   * Run load test
   */
  async runLoadTest(config: LoadTestConfig): Promise<LoadTestMetrics> {
    console.log(`🚀 Starting load test: ${config.pattern.type} pattern`);

    this.samples = [];
    this.running = true;

    const startTime = Date.now();
    const scenarioIndex = Math.floor(Math.random() * config.scenarios.length);
    const scenario = config.scenarios[scenarioIndex];

    // Warm-up phase
    if (config.warmupRequests && config.warmupRequests > 0) {
      console.log(`⏳ Warm-up: ${config.warmupRequests} requests`);
      for (let i = 0; i < config.warmupRequests; i++) {
        await this.executeRequest(scenario);
      }
    }

    // Main load test
    const loadPattern = this.generateLoadPattern(config.pattern);
    let requestCount = 0;

    for (const rps of loadPattern) {
      const intervalMs = 1000 / rps;
      const phaseStart = Date.now();

      while (Date.now() - phaseStart < 1000 && this.running) {
        const promises: Promise<void>[] = [];

        for (let i = 0; i < rps && promises.length < (config.concurrency || rps); i++) {
          promises.push(this.executeRequest(scenario));
          requestCount++;
        }

        await Promise.all(promises);
        await this.sleep(Math.max(0, intervalMs - (Date.now() - phaseStart)));
      }

      const elapsed = Date.now() - startTime;
      const progress = (elapsed / (config.pattern.durationSeconds * 1000)) * 100;
      console.log(`📊 ${progress.toFixed(1)}% | ${requestCount} requests | ${rps} RPS`);
    }

    const totalDuration = Date.now() - startTime;
    const metrics = this.calculateMetrics(totalDuration);

    console.log(`\n✅ Load test complete`);

    return metrics;
  }

  /**
   * Generate load pattern
   */
  private generateLoadPattern(pattern: LoadPattern): number[] {
    const rpsValues: number[] = [];
    const stepIntervalMs = 100; // Update RPS every 100ms
    const stepsPerSecond = 1000 / stepIntervalMs;
    const totalSteps = pattern.durationSeconds * stepsPerSecond;

    if (pattern.type === 'constant') {
      const rps = pattern.startRPS;
      for (let i = 0; i < totalSteps; i++) {
        rpsValues.push(rps);
      }
    } else if (pattern.type === 'ramp') {
      const endRPS = pattern.endRPS || pattern.startRPS;
      const increment = (endRPS - pattern.startRPS) / totalSteps;

      for (let i = 0; i < totalSteps; i++) {
        rpsValues.push(Math.round(pattern.startRPS + increment * i));
      }
    } else if (pattern.type === 'spike') {
      const spikeSteps = (pattern.spikeDurationSeconds || 5) * stepsPerSecond;

      for (let i = 0; i < totalSteps; i++) {
        const isSpikePhase = i % (spikeSteps * 2) < spikeSteps;
        rpsValues.push(isSpikePhase ? pattern.peakRPS || 100 : pattern.startRPS);
      }
    } else if (pattern.type === 'wave') {
      const waveSteps = (pattern.wavePeriodSeconds || 30) * stepsPerSecond;

      for (let i = 0; i < totalSteps; i++) {
        const wavePhase = (i % waveSteps) / waveSteps;
        const rps = Math.round(
          pattern.startRPS +
            (pattern.peakRPS || 100 - pattern.startRPS) * Math.sin(wavePhase * Math.PI)
        );
        rpsValues.push(Math.max(pattern.startRPS, rps));
      }
    }

    return rpsValues;
  }

  /**
   * Execute single request
   */
  private async executeRequest(scenario: LoadTestScenario): Promise<void> {
    const startTime = Date.now();

    try {
      const config: AxiosRequestConfig = {
        method: scenario.method || 'GET',
        url: scenario.endpoint,
        headers: scenario.headers,
        timeout: scenario.timeout || 30000,
      };

      if (scenario.data) {
        config.data = scenario.data;
      }

      const response = await this.client.request(config);

      this.samples.push({
        duration: Date.now() - startTime,
        statusCode: response.status,
        timestamp: startTime,
      });
    } catch (error) {
      const errorMessage = (error as Error).message;

      this.samples.push({
        duration: Date.now() - startTime,
        statusCode: 0,
        error: errorMessage,
        timestamp: startTime,
      });
    }
  }

  /**
   * Calculate metrics
   */
  private calculateMetrics(totalDuration: number): LoadTestMetrics {
    const sortedDurations = this.samples.map((s) => s.duration).sort((a, b) => a - b);

    const errors = new Map<string, number>();
    let failedCount = 0;

    for (const sample of this.samples) {
      if (sample.error || sample.statusCode >= 400) {
        failedCount++;
        const errorKey = sample.error || `HTTP ${sample.statusCode}`;
        errors.set(errorKey, (errors.get(errorKey) || 0) + 1);
      }
    }

    const successfulCount = this.samples.length - failedCount;
    const avgDuration = sortedDurations.reduce((a, b) => a + b, 0) / sortedDurations.length;

    return {
      totalRequests: this.samples.length,
      successfulRequests: successfulCount,
      failedRequests: failedCount,
      totalDuration,
      minResponseTime: sortedDurations[0] || 0,
      maxResponseTime: sortedDurations[sortedDurations.length - 1] || 0,
      avgResponseTime: avgDuration,
      p50ResponseTime: sortedDurations[Math.floor(sortedDurations.length * 0.5)] || 0,
      p95ResponseTime: sortedDurations[Math.floor(sortedDurations.length * 0.95)] || 0,
      p99ResponseTime: sortedDurations[Math.floor(sortedDurations.length * 0.99)] || 0,
      requestsPerSecond: (this.samples.length / totalDuration) * 1000,
      errorRate: this.samples.length > 0 ? failedCount / this.samples.length : 0,
      errors,
    };
  }

  /**
   * Print metrics report
   */
  static printMetricsReport(metrics: LoadTestMetrics, title?: string) {
    console.log('\n' + '='.repeat(60));
    if (title) console.log(`📈 ${title}`);
    console.log('='.repeat(60));
    console.log(`\n📊 Request Statistics:`);
    console.log(`   Total Requests:      ${metrics.totalRequests}`);
    console.log(
      `   Successful:          ${metrics.successfulRequests} (${((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(1)}%)`
    );
    console.log(
      `   Failed:              ${metrics.failedRequests} (${(metrics.errorRate * 100).toFixed(1)}%)`
    );
    console.log(`   Requests/sec:        ${metrics.requestsPerSecond.toFixed(2)}`);
    console.log(`\n⏱️  Response Time (ms):`);
    console.log(`   Min:                 ${metrics.minResponseTime.toFixed(2)}`);
    console.log(`   Avg:                 ${metrics.avgResponseTime.toFixed(2)}`);
    console.log(`   P50:                 ${metrics.p50ResponseTime.toFixed(2)}`);
    console.log(`   P95:                 ${metrics.p95ResponseTime.toFixed(2)}`);
    console.log(`   P99:                 ${metrics.p99ResponseTime.toFixed(2)}`);
    console.log(`   Max:                 ${metrics.maxResponseTime.toFixed(2)}`);

    if (metrics.errors.size > 0) {
      console.log(`\n❌ Errors:`);
      for (const [error, count] of metrics.errors) {
        console.log(`   ${error}: ${count}`);
      }
    }
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Stop test
   */
  stop() {
    this.running = false;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Run test suite with multiple scenarios
 */
export async function runLoadTestSuite(
  configs: LoadTestConfig[]
): Promise<Map<string, LoadTestMetrics>> {
  const results = new Map<string, LoadTestMetrics>();

  for (const config of configs) {
    const tester = new LoadTester(config.baseURL);
    const metrics = await tester.runLoadTest(config);
    results.set(config.pattern.type, metrics);

    LoadTester.printMetricsReport(metrics, `${config.pattern.type} Pattern`);

    // Wait between tests
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return results;
}
