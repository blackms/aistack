import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
  type Metric,
} from '../../../src/monitoring/metrics.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    resetMetricsCollector();
    collector = new MetricsCollector();
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetMetricsCollector();
  });

  describe('constructor', () => {
    it('should create metrics collector', () => {
      expect(collector).toBeInstanceOf(MetricsCollector);
    });

    it('should initialize system metrics', () => {
      const metrics = collector.getAllMetrics();
      expect(metrics.length).toBeGreaterThan(0);

      const metricNames = metrics.map((m) => m.name);
      expect(metricNames).toContain('process_uptime_seconds');
      expect(metricNames).toContain('process_memory_heap_used_bytes');
      expect(metricNames).toContain('agents_spawned_total');
      expect(metricNames).toContain('workflows_started_total');
    });
  });

  describe('registerCounter', () => {
    it('should register new counter', () => {
      collector.registerCounter('test_counter', 'Test counter');
      const metrics = collector.getAllMetrics();

      const counter = metrics.find((m) => m.name === 'test_counter');
      expect(counter).toBeDefined();
      expect(counter?.type).toBe('counter');
      expect(counter?.help).toBe('Test counter');
      expect(counter?.value).toBe(0);
    });

    it('should not override existing counter', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 5);
      collector.registerCounter('test_counter', 'Updated help');

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(5);
    });
  });

  describe('registerGauge', () => {
    it('should register new gauge', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      const metrics = collector.getAllMetrics();

      const gauge = metrics.find((m) => m.name === 'test_gauge');
      expect(gauge).toBeDefined();
      expect(gauge?.type).toBe('gauge');
      expect(gauge?.help).toBe('Test gauge');
      expect(gauge?.value).toBe(0);
    });

    it('should not override existing gauge', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42);
      collector.registerGauge('test_gauge', 'Updated help');

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.value).toBe(42);
    });
  });

  describe('registerHistogram', () => {
    it('should register new histogram', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      const metrics = collector.getAllMetrics();

      const histogram = metrics.find((m) => m.name === 'test_histogram');
      expect(histogram).toBeDefined();
      expect(histogram?.type).toBe('histogram');
      expect(histogram?.help).toBe('Test histogram');
      expect(histogram?.value).toEqual({
        count: 0,
        sum: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      });
    });

    it('should not override existing histogram', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      collector.observeHistogram('test_histogram', 10);
      collector.registerHistogram('test_histogram', 'Updated help');

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      expect((histogram?.value as any).count).toBe(1);
    });
  });

  describe('incrementCounter', () => {
    it('should increment counter by 1 by default', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter');

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(1);
    });

    it('should increment counter by specified value', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 5);

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(5);
    });

    it('should accumulate increments', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 3);
      collector.incrementCounter('test_counter', 7);
      collector.incrementCounter('test_counter', 2);

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(12);
    });

    it('should add labels to counter', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 1, { status: 'success' });

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.labels).toEqual({ status: 'success' });
    });

    it('should ignore increment on non-existent counter', () => {
      collector.incrementCounter('non_existent', 5);
      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'non_existent');

      expect(counter).toBeUndefined();
    });

    it('should ignore increment on non-counter metric', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.incrementCounter('test_gauge', 5);

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.value).toBe(0);
    });
  });

  describe('setGauge', () => {
    it('should set gauge value', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42);

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.value).toBe(42);
    });

    it('should overwrite previous gauge value', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42);
      collector.setGauge('test_gauge', 99);

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.value).toBe(99);
    });

    it('should add labels to gauge', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42, { host: 'server1' });

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.labels).toEqual({ host: 'server1' });
    });

    it('should ignore set on non-existent gauge', () => {
      collector.setGauge('non_existent', 42);
      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'non_existent');

      expect(gauge).toBeUndefined();
    });

    it('should ignore set on non-gauge metric', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.setGauge('test_counter', 42);

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(0);
    });
  });

  describe('observeHistogram', () => {
    it('should observe histogram value', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      collector.observeHistogram('test_histogram', 10);

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      expect((histogram?.value as any).count).toBe(1);
      expect((histogram?.value as any).sum).toBe(10);
      expect((histogram?.value as any).min).toBe(10);
      expect((histogram?.value as any).max).toBe(10);
      expect((histogram?.value as any).avg).toBe(10);
    });

    it('should calculate statistics for multiple observations', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      collector.observeHistogram('test_histogram', 10);
      collector.observeHistogram('test_histogram', 20);
      collector.observeHistogram('test_histogram', 30);

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      expect((histogram?.value as any).count).toBe(3);
      expect((histogram?.value as any).sum).toBe(60);
      expect((histogram?.value as any).min).toBe(10);
      expect((histogram?.value as any).max).toBe(30);
      expect((histogram?.value as any).avg).toBe(20);
      expect((histogram?.value as any).p50).toBe(20);
    });

    it('should calculate percentiles correctly', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');

      // Add 100 values from 1 to 100
      for (let i = 1; i <= 100; i++) {
        collector.observeHistogram('test_histogram', i);
      }

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      expect((histogram?.value as any).count).toBe(100);
      expect((histogram?.value as any).p50).toBe(50);
      expect((histogram?.value as any).p95).toBeGreaterThan(90);
      expect((histogram?.value as any).p99).toBeGreaterThan(95);
    });

    it('should limit histogram size to prevent memory leak', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');

      // Add more than MAX_HISTOGRAM_SAMPLES (10000)
      for (let i = 0; i < 12000; i++) {
        collector.observeHistogram('test_histogram', i);
      }

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      // After cleanup, should have less than MAX_HISTOGRAM_SAMPLES
      // The actual count depends on how many were added after cleanup triggered
      expect((histogram?.value as any).count).toBeLessThan(10000);
      expect((histogram?.value as any).count).toBeGreaterThan(5000);
    });

    it('should ignore observe on non-existent histogram', () => {
      collector.observeHistogram('non_existent', 10);
      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'non_existent');

      expect(histogram).toBeUndefined();
    });
  });

  describe('updateSystemMetrics', () => {
    it('should update process uptime', () => {
      collector.updateSystemMetrics();
      const metrics = collector.getAllMetrics();
      const uptime = metrics.find((m) => m.name === 'process_uptime_seconds');

      expect(uptime?.value).toBeGreaterThanOrEqual(0);
    });

    it('should update memory metrics', () => {
      collector.updateSystemMetrics();
      const metrics = collector.getAllMetrics();

      const heapUsed = metrics.find((m) => m.name === 'process_memory_heap_used_bytes');
      const heapTotal = metrics.find((m) => m.name === 'process_memory_heap_total_bytes');
      const external = metrics.find((m) => m.name === 'process_memory_external_bytes');
      const rss = metrics.find((m) => m.name === 'process_memory_rss_bytes');

      expect(heapUsed?.value).toBeGreaterThan(0);
      expect(heapTotal?.value).toBeGreaterThan(0);
      expect(external?.value).toBeGreaterThanOrEqual(0);
      expect(rss?.value).toBeGreaterThan(0);
    });

    it('should update CPU metrics', () => {
      collector.updateSystemMetrics();
      const metrics = collector.getAllMetrics();
      const cpuUsage = metrics.find((m) => m.name === 'process_cpu_usage_percent');

      expect(cpuUsage?.value).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAllMetrics', () => {
    it('should return all registered metrics', () => {
      const metrics = collector.getAllMetrics();

      expect(Array.isArray(metrics)).toBe(true);
      expect(metrics.length).toBeGreaterThan(0);
    });

    it('should update system metrics before returning', () => {
      const metrics1 = collector.getAllMetrics();
      const uptime1 = metrics1.find((m) => m.name === 'process_uptime_seconds')?.value;

      // Wait a bit
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const metrics2 = collector.getAllMetrics();
      const uptime2 = metrics2.find((m) => m.name === 'process_uptime_seconds')?.value;

      expect(uptime2).toBeGreaterThanOrEqual(uptime1 as number);
    });

    it('should include custom metrics', () => {
      collector.registerCounter('custom_counter', 'Custom counter');
      collector.incrementCounter('custom_counter', 5);

      const metrics = collector.getAllMetrics();
      const custom = metrics.find((m) => m.name === 'custom_counter');

      expect(custom).toBeDefined();
      expect(custom?.value).toBe(5);
    });
  });

  describe('exportPrometheus', () => {
    it('should export metrics in Prometheus format', () => {
      const output = collector.exportPrometheus();

      expect(output).toContain('# HELP process_uptime_seconds');
      expect(output).toContain('# TYPE process_uptime_seconds gauge');
      expect(output).toContain('process_uptime_seconds');
    });

    it('should export counter metrics', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 5);

      const output = collector.exportPrometheus();

      expect(output).toContain('# HELP test_counter Test counter');
      expect(output).toContain('# TYPE test_counter counter');
      expect(output).toContain('test_counter 5');
    });

    it('should export gauge metrics', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42);

      const output = collector.exportPrometheus();

      expect(output).toContain('# HELP test_gauge Test gauge');
      expect(output).toContain('# TYPE test_gauge gauge');
      expect(output).toContain('test_gauge 42');
    });

    it('should export histogram metrics with statistics', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      collector.observeHistogram('test_histogram', 10);
      collector.observeHistogram('test_histogram', 20);
      collector.observeHistogram('test_histogram', 30);

      const output = collector.exportPrometheus();

      expect(output).toContain('# HELP test_histogram Test histogram');
      expect(output).toContain('# TYPE test_histogram histogram');
      expect(output).toContain('test_histogram_count 3');
      expect(output).toContain('test_histogram_sum 60');
      expect(output).toContain('test_histogram_min 10');
      expect(output).toContain('test_histogram_max 30');
      expect(output).toContain('test_histogram_avg 20');
      expect(output).toContain('test_histogram{quantile="0.5"}');
      expect(output).toContain('test_histogram{quantile="0.95"}');
      expect(output).toContain('test_histogram{quantile="0.99"}');
    });

    it('should export metrics with labels', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 5, { status: 'success', code: '200' });

      const output = collector.exportPrometheus();

      expect(output).toContain('test_counter{status="success",code="200"} 5');
    });

    it('should update system metrics before exporting', () => {
      const output = collector.exportPrometheus();

      expect(output).toContain('process_uptime_seconds');
      expect(output).toContain('process_memory_heap_used_bytes');
    });
  });

  describe('reset', () => {
    it('should reset all counter values to 0', () => {
      collector.registerCounter('test_counter', 'Test counter');
      collector.incrementCounter('test_counter', 5);

      collector.reset();

      const metrics = collector.getAllMetrics();
      const counter = metrics.find((m) => m.name === 'test_counter');

      expect(counter?.value).toBe(0);
    });

    it('should reset all gauge values to 0', () => {
      collector.registerGauge('test_gauge', 'Test gauge');
      collector.setGauge('test_gauge', 42);

      collector.reset();

      const metrics = collector.getAllMetrics();
      const gauge = metrics.find((m) => m.name === 'test_gauge');

      expect(gauge?.value).toBe(0);
    });

    it('should reset all histogram values', () => {
      collector.registerHistogram('test_histogram', 'Test histogram');
      collector.observeHistogram('test_histogram', 10);
      collector.observeHistogram('test_histogram', 20);

      collector.reset();

      const metrics = collector.getAllMetrics();
      const histogram = metrics.find((m) => m.name === 'test_histogram');

      expect((histogram?.value as any).count).toBe(0);
      expect((histogram?.value as any).sum).toBe(0);
    });

    it('should reset start time', async () => {
      // Wait a bit to accumulate some uptime
      await new Promise((resolve) => setTimeout(resolve, 10));

      const metrics1 = collector.getAllMetrics();
      const uptime1 = metrics1.find((m) => m.name === 'process_uptime_seconds')?.value;

      collector.reset();

      const metrics2 = collector.getAllMetrics();
      const uptime2 = metrics2.find((m) => m.name === 'process_uptime_seconds')?.value;

      // After reset, uptime should be close to 0 (less than the previous uptime)
      expect(uptime2).toBeLessThanOrEqual(uptime1 as number);
      expect(uptime2).toBeGreaterThanOrEqual(0);
    });
  });

  describe('singleton functions', () => {
    it('should create and return singleton instance', () => {
      const collector1 = getMetricsCollector();
      const collector2 = getMetricsCollector();

      expect(collector1).toBe(collector2);
    });

    it('should reset singleton', () => {
      const collector1 = getMetricsCollector();
      resetMetricsCollector();
      const collector2 = getMetricsCollector();

      expect(collector1).not.toBe(collector2);
    });
  });

  describe('application metrics', () => {
    it('should track agent metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('agents_spawned_total');
      expect(metricNames).toContain('agents_stopped_total');
      expect(metricNames).toContain('agents_failed_total');
      expect(metricNames).toContain('agents_active_current');
    });

    it('should track workflow metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('workflows_started_total');
      expect(metricNames).toContain('workflows_completed_total');
      expect(metricNames).toContain('workflows_failed_total');
      expect(metricNames).toContain('workflows_active_current');
    });

    it('should track review loop metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('review_loops_started_total');
      expect(metricNames).toContain('review_loops_approved_total');
      expect(metricNames).toContain('review_loops_rejected_total');
      expect(metricNames).toContain('review_loops_active_current');
    });

    it('should track task metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('tasks_created_total');
      expect(metricNames).toContain('tasks_completed_total');
      expect(metricNames).toContain('tasks_failed_total');
      expect(metricNames).toContain('tasks_queued_current');
      expect(metricNames).toContain('tasks_processing_current');
    });

    it('should track memory metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('memory_entries_stored_total');
      expect(metricNames).toContain('memory_entries_deleted_total');
      expect(metricNames).toContain('memory_searches_total');
      expect(metricNames).toContain('memory_entries_current');
    });

    it('should track HTTP metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('http_requests_total');
      expect(metricNames).toContain('http_requests_errors_total');
      expect(metricNames).toContain('http_request_duration_seconds');
    });

    it('should track WebSocket metrics', () => {
      const metrics = collector.getAllMetrics();
      const metricNames = metrics.map((m) => m.name);

      expect(metricNames).toContain('websocket_connections_total');
      expect(metricNames).toContain('websocket_messages_sent_total');
      expect(metricNames).toContain('websocket_messages_received_total');
      expect(metricNames).toContain('websocket_clients_current');
    });
  });
});
