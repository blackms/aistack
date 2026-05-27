/**
 * Workflow DSL executor tests.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseWorkflowObject,
  runWorkflow,
  WorkflowContext,
  resolveInput,
  evaluateCondition,
  type RunStepHook,
  type StepResult,
} from '../../../../src/workflows/dsl/index.js';

async function drain(gen: AsyncGenerator<StepResult>): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for await (const r of gen) out.push(r);
  return out;
}

describe('executor — linear execution', () => {
  it('runs steps in order and passes $prev.output', async () => {
    const calls: Array<{ agent: string; input: string }> = [];
    const runStep: RunStepHook = vi.fn(async (args) => {
      calls.push({ agent: args.agent, input: args.input });
      return { output: `${args.agent}-result` };
    });

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { agent: 'coder', input: 'go' },
        { agent: 'tester', input: 'check $prev.output' },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results).toHaveLength(2);
    expect(results[0].output).toBe('coder-result');
    expect(results[1].output).toBe('tester-result');
    expect(calls[1].input).toBe('check coder-result');
  });

  it('resolves $task.input and $steps.<id>.output', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: `[${args.input}]` }));

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { id: 'first', agent: 'coder', input: 'task=$task.input' },
        { agent: 'tester', input: 'echo $steps.first.output' },
      ],
    });
    const ctx = new WorkflowContext({ task: { input: 'hello' }, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results[0].output).toBe('[task=hello]');
    expect(results[1].output).toBe('[echo [task=hello]]');
  });
});

describe('executor — on_reject loop-back', () => {
  it('jumps back on REJECT and accepts on retry', async () => {
    let reviewCalls = 0;
    const runStep: RunStepHook = vi.fn(async (args) => {
      if (args.agent === 'coder') return { output: 'code-v' + (reviewCalls + 1) };
      reviewCalls++;
      const verdict = reviewCalls >= 2 ? 'APPROVE' : 'REJECT';
      return { output: `review #${reviewCalls}`, verdict };
    });

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { id: 'code', agent: 'coder', input: '$task.input' },
        { id: 'rev', agent: 'adversarial', input: '$steps.code.output', on_reject: { goto: 'code', max_retries: 3 } },
      ],
    });
    const ctx = new WorkflowContext({ task: { input: 'do it' }, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    // code, rev (reject), code, rev (approve)
    expect(results.filter((r) => r.agent === 'coder')).toHaveLength(2);
    expect(results.filter((r) => r.agent === 'adversarial')).toHaveLength(2);
    expect(results[results.length - 1].verdict).toBe('APPROVE');
  });

  it('caps retries at max_retries and surfaces failure when fail_after=true', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => {
      if (args.agent === 'coder') return { output: 'c' };
      return { output: 'r', verdict: 'REJECT' };
    });

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { id: 'c', agent: 'coder', input: 'x' },
        { id: 'r', agent: 'adversarial', input: '$prev.output', on_reject: { goto: 'c', max_retries: 2, fail_after: true } },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    // Initial coder + initial adversarial(REJECT)
    // -> goto c (retry 1): coder + adversarial(REJECT)
    // -> goto c (retry 2): coder + adversarial(REJECT)
    // -> retries exhausted, emit failure result
    const coderCount = results.filter((r) => r.agent === 'coder').length;
    expect(coderCount).toBe(3);
    expect(results[results.length - 1].error).toMatch(/retries exhausted/);
  });
});

describe('executor — parallel', () => {
  it('runs nested parallel steps and concatenates outputs', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: `${args.agent}:${args.input}` }));

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        {
          id: 'fan',
          parallel: [
            { agent: 'a1', input: 'x' },
            { agent: 'a2', input: 'y' },
          ],
        },
        { agent: 'merge', input: '$steps.fan.output' },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results[0].parallelResults).toHaveLength(2);
    expect(results[0].output).toBe('a1:x\n---\na2:y');
    expect(results[1].output).toContain('a1:x');
  });
});

describe('executor — if-condition skip', () => {
  it('skips a step whose `if` expression is false', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: args.agent }));
    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { id: 'a', agent: 'coder', input: 'x' },
        { id: 'b', agent: 'tester', input: 'y', if: '$task.run_tests == yes' },
      ],
    });
    const ctx = new WorkflowContext({ task: { run_tests: 'no' }, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results[1].skipped).toBe(true);
    expect(runStep).toHaveBeenCalledTimes(1);
  });

  it('runs a step whose `if` expression is true', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: args.agent }));
    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { id: 'a', agent: 'coder', input: 'x' },
        { id: 'b', agent: 'tester', input: 'y', if: '$task.run_tests == yes' },
      ],
    });
    const ctx = new WorkflowContext({ task: { run_tests: 'yes' }, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results[1].skipped).toBeFalsy();
    expect(runStep).toHaveBeenCalledTimes(2);
  });
});

describe('executor — error handling', () => {
  it('captures thrown errors and surfaces them in StepResult', async () => {
    const runStep: RunStepHook = vi.fn(async () => {
      throw new Error('boom');
    });
    const doc = parseWorkflowObject({
      name: 't',
      steps: [{ agent: 'coder', input: 'x' }],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results[0].error).toBe('boom');
  });
});

describe('resolveInput / evaluateCondition utility', () => {
  it('resolveInput handles object inputs via JSON stringify', () => {
    const ctx = new WorkflowContext({ task: { input: 'world' }, runStep: async () => ({ output: '' }) });
    const out = resolveInput({ greeting: 'hello $task.input' }, ctx);
    expect(out).toContain('hello world');
  });

  it('evaluateCondition supports contains', () => {
    const ctx = new WorkflowContext({ task: { foo: 'abcdef' }, runStep: async () => ({ output: '' }) });
    expect(evaluateCondition('$task.foo contains cde', ctx)).toBe(true);
    expect(evaluateCondition('$task.foo contains zzz', ctx)).toBe(false);
  });

  it('evaluateCondition supports exists', () => {
    const ctx = new WorkflowContext({ task: { foo: 'x' }, runStep: async () => ({ output: '' }) });
    expect(evaluateCondition('$task.foo exists', ctx)).toBe(true);
    expect(evaluateCondition('$task.missing exists', ctx)).toBe(false);
  });
});
