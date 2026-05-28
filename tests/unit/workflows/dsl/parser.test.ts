/**
 * Workflow DSL parser tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseWorkflow,
  parseWorkflowObject,
  WorkflowParseError,
} from '../../../../src/workflows/dsl/index.js';

describe('parseWorkflow', () => {
  it('accepts a minimal valid JSON workflow', async () => {
    const doc = await parseWorkflow(
      JSON.stringify({
        name: 'simple',
        steps: [{ agent: 'coder', input: 'hello' }],
      })
    );
    expect(doc.name).toBe('simple');
    expect(doc.steps).toHaveLength(1);
    expect(doc.steps[0].agent).toBe('coder');
  });

  it('rejects a workflow with no steps', async () => {
    await expect(parseWorkflow(JSON.stringify({ name: 'empty', steps: [] }))).rejects.toThrow(
      WorkflowParseError
    );
  });

  it('rejects a step missing both agent and parallel', () => {
    expect(() =>
      parseWorkflowObject({
        name: 'bad',
        steps: [{ input: 'x' }],
      })
    ).toThrow(WorkflowParseError);
  });

  it('accepts on_reject clause with goto by id', () => {
    const doc = parseWorkflowObject({
      name: 'loop',
      steps: [
        { id: 'a', agent: 'coder', input: 'x' },
        {
          id: 'b',
          agent: 'adversarial',
          input: '$steps.a.output',
          on_reject: { goto: 'a', max_retries: 5 },
        },
      ],
    });
    expect(doc.steps[1].on_reject?.goto).toBe('a');
    expect(doc.steps[1].on_reject?.max_retries).toBe(5);
  });

  it('applies default max_retries=3 when on_reject omits it', () => {
    const doc = parseWorkflowObject({
      name: 'loop',
      steps: [
        { id: 'a', agent: 'coder', input: 'x' },
        { agent: 'adversarial', input: '$prev.output', on_reject: { goto: 'a' } },
      ],
    });
    expect(doc.steps[1].on_reject?.max_retries).toBe(3);
  });

  it('rejects malformed step ids', () => {
    expect(() =>
      parseWorkflowObject({
        name: 'bad',
        steps: [{ id: 'has spaces', agent: 'coder', input: 'x' }],
      })
    ).toThrow(WorkflowParseError);
  });

  it('throws WorkflowParseError on empty input', async () => {
    await expect(parseWorkflow('')).rejects.toThrow(WorkflowParseError);
  });

  it('throws on invalid JSON when input starts with {', async () => {
    await expect(parseWorkflow('{not valid')).rejects.toThrow(WorkflowParseError);
  });

  it('accepts a parallel block', () => {
    const doc = parseWorkflowObject({
      name: 'fanout',
      steps: [
        {
          id: 'fan',
          parallel: [
            { agent: 'researcher', input: 'A' },
            { agent: 'researcher', input: 'B' },
          ],
        },
      ],
    });
    expect(doc.steps[0].parallel).toHaveLength(2);
  });
});

describe('parseWorkflow — YAML', () => {
  it('round-trips a YAML workflow into a validated doc', async () => {
    const yaml = [
      'name: yaml-flow',
      'description: a yaml workflow',
      'version: "1"',
      'steps:',
      '  - id: write',
      '    agent: coder',
      '    input: hello',
      '  - id: review',
      '    agent: adversarial',
      '    input: $steps.write.output',
      '    on_reject:',
      '      goto: write',
      '      max_retries: 2',
    ].join('\n');
    const doc = await parseWorkflow(yaml);
    expect(doc.name).toBe('yaml-flow');
    expect(doc.steps).toHaveLength(2);
    expect(doc.steps[0].agent).toBe('coder');
    expect(doc.steps[1].on_reject?.goto).toBe('write');
    expect(doc.steps[1].on_reject?.max_retries).toBe(2);
  });

  it('rejects malformed YAML with a WorkflowParseError', async () => {
    // Unclosed flow mapping → YAML parser error
    const broken = 'name: bad\nsteps:\n  - { agent: coder, input: "oops';
    await expect(parseWorkflow(broken)).rejects.toThrow(WorkflowParseError);
  });
});

describe('parseWorkflow — version handling', () => {
  it('accepts the current supported version', () => {
    const doc = parseWorkflowObject({
      name: 'v1',
      version: '1',
      steps: [{ agent: 'coder', input: 'x' }],
    });
    expect(doc.version).toBe('1');
  });

  it('accepts same-major same-minor (e.g. 1.0)', () => {
    const doc = parseWorkflowObject({
      name: 'v1',
      version: '1.0',
      steps: [{ agent: 'coder', input: 'x' }],
    });
    expect(doc.version).toBe('1.0');
  });

  it('rejects a major-version mismatch', () => {
    expect(() =>
      parseWorkflowObject({
        name: 'future',
        version: '2',
        steps: [{ agent: 'coder', input: 'x' }],
      })
    ).toThrow(WorkflowParseError);
  });

  it('warns (does not throw) on higher minor within same major', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const doc = parseWorkflowObject({
        name: 'minor-up',
        version: '1.99',
        steps: [{ agent: 'coder', input: 'x' }],
      });
      expect(doc.version).toBe('1.99');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a non-numeric version string', () => {
    expect(() =>
      parseWorkflowObject({
        name: 'bad',
        version: 'banana',
        steps: [{ agent: 'coder', input: 'x' }],
      })
    ).toThrow(WorkflowParseError);
  });
});
