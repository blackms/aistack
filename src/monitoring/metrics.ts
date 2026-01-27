/**
 * Prometheus metrics collection for monitoring
 */

import { logger } from '../utils/logger.js';

const log = logger.child('metrics');

// Constants for histogram management
const MAX_HISTOGRAM_SAMPLES = 10000;
const HISTOGRAM_CLEANUP_THRESHOLD = 5000;

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help: string;
  value: number | Record<string, number>;
  labels?: Record<string, string>;
}

export class MetricsCollector {
  private metrics: Map<string, Metric> = new Map();
  private startTime: number = Date.now();
  private histograms: Map<string, number[]> = new Map();

  constructor() {
    // Initialize system metrics
    this.initializeSystemMetrics();
  }

  private initializeSystemMetrics(): void {
    // Process metrics
    this.registerGauge('process_uptime_seconds', 'Process uptime in seconds');
    this.registerGauge('process_memory_heap_used_bytes', 'Heap memory used in bytes');
    this.registerGauge('process_memory_heap_total_bytes', 'Total heap memory in bytes');
    this.registerGauge('process_memory_external_bytes', 'External memory in bytes');
    this.registerGauge('process_memory_rss_bytes', 'Resident set size in bytes');
    this.registerGauge('process_cpu_usage_percent', 'CPU usage percentage');

    // Application metrics
    this.registerCounter('agents_spawned_total', 'Total number of agents spawned');
    this.registerCounter('agents_stopped_total', 'Total number of agents stopped');
    this.registerCounter('agents_failed_total', 'Total number of failed agents');
    this.registerGauge('agents_active_current', 'Current number of active agents');

    this.registerCounter('workflows_started_total', 'Total number of workflows started');
    this.registerCounter('workflows_completed_total', 'Total number of completed workflows');
    this.registerCounter('workflows_failed_total', 'Total number of failed workflows');
    this.registerGauge('workflows_active_current', 'Current number of active workflows');

    this.registerCounter('review_loops_started_total', 'Total number of review loops started');
    this.registerCounter('review_loops_approved_total', 'Total number of approved review loops');
    this.registerCounter('review_loops_rejected_total', 'Total number of rejected review loops');
    this.registerGauge('review_loops_active_current', 'Current number of active review loops');

    this.registerCounter('tasks_created_total', 'Total number of tasks created');
    this.registerCounter('tasks_completed_total', 'Total number of completed tasks');
    this.registerCounter('tasks_failed_total', 'Total number of failed tasks');
    this.registerGauge('tasks_queued_current', 'Current number of queued tasks');
    this.registerGauge('tasks_processing_current', 'Current number of processing tasks');

    this.registerCounter('memory_entries_stored_total', 'Total number of memory entries stored');
    this.registerCounter('memory_entries_deleted_total', 'Total number of memory entries deleted');
    this.registerCounter('memory_searches_total', 'Total number of memory searches');
    this.registerGauge('memory_entries_current', 'Current number of memory entries');

    this.registerCounter('http_requests_total', 'Total number of HTTP requests');
    this.registerCounter('http_requests_errors_total', 'Total number of HTTP request errors');
    this.registerHistogram('http_request_duration_seconds', 'HTTP request duration in seconds');

    this.registerCounter('websocket_connections_total', 'Total number of WebSocket connections');
    this.registerCounter('websocket_messages_sent_total', 'Total number of WebSocket messages sent');
    this.registerCounter('websocket_messages_received_total', 'Total number of WebSocket messages received');
    this.registerGauge('websocket_clients_current', 'Current number of WebSocket clients');

    // Resource exhaustion metrics
    this.registerCounter('resource_exhaustion_warnings_total', 'Total resource warning events');
    this.registerCounter('resource_exhaustion_interventions_total', 'Total resource intervention events');
    this.registerCounter('resource_exhaustion_terminations_total', 'Total resource termination events');
    this.registerGauge('agents_paused_current', 'Current number of paused agents');
    this.registerHistogram('agent_files_accessed', 'Files accessed per agent session');
    this.registerHistogram('agent_api_calls', 'API calls per agent session');
    this.registerHistogram('agent_tokens_consumed', 'Tokens consumed per agent session');

    log.debug('System metrics initialized');
  }

  // Register metric types
  registerCounter(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'counter',
        help,
        value: 0,
      });
    }
  }

  registerGauge(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'gauge',
        help,
        value: 0,
      });
    }
  }

  registerHistogram(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'histogram',
        help,
        value: {},
      });
      this.histograms.set(name, []);
    }
  }

  // Increment counter
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'counter') {
      if (typeof metric.value === 'number') {
        metric.value += value;
        metric.labels = labels;
      }
    }
  }

  // Set gauge value
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'gauge') {
      metric.value = value;
      metric.labels = labels;
    }
  }

  // Observe histogram value
  observeHistogram(name: string, value: number): void {
    const values = this.histograms.get(name);
    if (values) {
      values.push(value);

      // Prevent memory leak by limiting histogram size
      // Keep a sliding window of recent samples
      if (values.length > MAX_HISTOGRAM_SAMPLES) {
        // Remove oldest samples when threshold is exceeded
        values.splice(0, values.length - HISTOGRAM_CLEANUP_THRESHOLD);
        log.debug(`Histogram ${name} trimmed to ${HISTOGRAM_CLEANUP_THRESHOLD} samples`);
      }
    }
  }

  // Update system metrics
  updateSystemMetrics(): void {
    const uptime = (Date.now() - this.startTime) / 1000;
    this.setGauge('process_uptime_seconds', uptime);

    const memUsage = process.memoryUsage();
    this.setGauge('process_memory_heap_used_bytes', memUsage.heapUsed);
    this.setGauge('process_memory_heap_total_bytes', memUsage.heapTotal);
    this.setGauge('process_memory_external_bytes', memUsage.external);
    this.setGauge('process_memory_rss_bytes', memUsage.rss);

    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000 / uptime * 100;
    this.setGauge('process_cpu_usage_percent', cpuPercent);
  }

  // Calculate histogram statistics
  private calculateHistogramStats(values: number[]): Record<string, number> {
    if (values.length === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);

    const getPercentile = (p: number) => {
      const index = Math.ceil(sorted.length * p) - 1;
      return sorted[Math.max(0, index)];
    };

    return {
      count: sorted.length,
      sum,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: getPercentile(0.5),
      p95: getPercentile(0.95),
      p99: getPercentile(0.99),
    };
  }

  // Get all metrics
  getAllMetrics(): Metric[] {
    this.updateSystemMetrics();

    const metricsArray: Metric[] = [];

    for (const [name, metric] of this.metrics.entries()) {
      if (metric.type === 'histogram') {
        const values = this.histograms.get(name) || [];
        const stats = this.calculateHistogramStats(values);
        metricsArray.push({
          ...metric,
          value: stats,
        });
      } else {
        metricsArray.push(metric);
      }
    }

    return metricsArray;
  }

  // Export metrics in Prometheus format
  exportPrometheus(): string {
    this.updateSystemMetrics();

    let output = '';

    for (const [name, metric] of this.metrics.entries()) {
      output += `# HELP ${name} ${metric.help}\n`;
      output += `# TYPE ${name} ${metric.type}\n`;

      if (metric.type === 'histogram') {
        const values = this.histograms.get(name) || [];
        const stats = this.calculateHistogramStats(values);

        output += `${name}_count ${stats.count}\n`;
        output += `${name}_sum ${stats.sum}\n`;
        output += `${name}_min ${stats.min}\n`;
        output += `${name}_max ${stats.max}\n`;
        output += `${name}_avg ${stats.avg}\n`;
        output += `${name}{quantile="0.5"} ${stats.p50}\n`;
        output += `${name}{quantile="0.95"} ${stats.p95}\n`;
        output += `${name}{quantile="0.99"} ${stats.p99}\n`;
      } else {
        const labels = metric.labels
          ? '{' + Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',') + '}'
          : '';
        output += `${name}${labels} ${metric.value}\n`;
      }

      output += '\n';
    }

    return output;
  }

  // Reset all metrics
  reset(): void {
    for (const metric of this.metrics.values()) {
      if (metric.type === 'counter' || metric.type === 'gauge') {
        metric.value = 0;
      } else if (metric.type === 'histogram') {
        metric.value = {};
      }
    }
    for (const values of this.histograms.values()) {
      values.length = 0;
    }
    this.startTime = Date.now();
  }
}

// Singleton instance
let instance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!instance) {
    instance = new MetricsCollector();
  }
  return instance;
}

export function resetMetricsCollector(): void {
  instance = null;
}
