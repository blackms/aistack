/**
 * Workflow DSL parser tests.
 */

import { describe, it, expect } from 'vitest';
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
