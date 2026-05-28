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

describe('executor — prototype-pollution defence', () => {
  it('does not traverse __proto__ in $task.<path>', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: args.input }));
    const doc = parseWorkflowObject({
      name: 't',
      steps: [{ agent: 'coder', input: 'val=[$task.__proto__.polluted]' }],
    });
    // Plant a property on Object.prototype to confirm it does NOT leak out.
    // (Cleaned up in finally.)
    (Object.prototype as Record<string, unknown>).polluted = 'PWNED';
    try {
      const ctx = new WorkflowContext({ task: {}, runStep });
      const results = await drain(runWorkflow(doc, ctx));
      expect(results[0].output).toBe('val=[]');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('does not traverse "constructor" or "prototype" keys', async () => {
    const runStep: RunStepHook = vi.fn(async (args) => ({ output: args.input }));
    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { agent: 'coder', input: 'c=[$task.constructor.name]|p=[$task.prototype.foo]' },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));
    expect(results[0].output).toBe('c=[]|p=[]');
  });
});

describe('executor — max_iterations off-by-one', () => {
  it('allows exactly max_iterations executions and fails on the next', async () => {
    let n = 0;
    const runStep: RunStepHook = vi.fn(async () => {
      n++;
      return { output: 'r', verdict: 'REJECT' };
    });
    const doc = parseWorkflowObject({
      name: 't',
      max_iterations: 3,
      steps: [
        { id: 'a', agent: 'coder', input: 'x' },
        // Loops back to 'a' on every reject, with a high retry cap so the
        // global iteration limit is what actually stops the run.
        { id: 'b', agent: 'adversarial', input: '$prev.output', on_reject: { goto: 'a', max_retries: 99 } },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const results = await drain(runWorkflow(doc, ctx));
    // Exactly 3 step executions, plus the synthetic "exceeded" failure result.
    expect(n).toBe(3);
    expect(results[results.length - 1].error).toMatch(/Exceeded max_iterations \(3\)/);
  });
});

describe('executor — parallel fail-fast abort', () => {
  it('aborts sibling parallel children when one fails', async () => {
    const aborts: string[] = [];
    const runStep: RunStepHook = vi.fn(async (args) => {
      if (args.agent === 'fast-fail') {
        // Fail immediately
        throw new Error('fast fail');
      }
      // Slow sibling — should receive an abort while sleeping
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ output: 'late' }), 5000);
        args.signal?.addEventListener('abort', () => {
          clearTimeout(t);
          aborts.push(args.agent);
          reject(new Error('aborted'));
        });
      });
    });

    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        {
          id: 'fan',
          parallel: [
            { agent: 'fast-fail', input: 'a' },
            { agent: 'slow', input: 'b' },
          ],
        },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep });
    const start = Date.now();
    const results = await drain(runWorkflow(doc, ctx));
    const elapsed = Date.now() - start;
    expect(aborts).toContain('slow');
    expect(elapsed).toBeLessThan(2000); // Did not wait for the 5s timeout
    expect(results[0].parallelResults?.some((r) => r.error?.includes('fast fail'))).toBe(true);
  });
});

describe('executor — hot-reload abort propagation', () => {
  it('stops the running workflow when the abortSignal fires', async () => {
    const controller = new AbortController();
    let stepsRun = 0;
    const runStep: RunStepHook = vi.fn(async () => {
      stepsRun++;
      // Trigger abort partway through the run
      if (stepsRun === 1) controller.abort();
      return { output: 's' };
    });
    const doc = parseWorkflowObject({
      name: 't',
      steps: [
        { agent: 'a', input: 'x' },
        { agent: 'b', input: 'y' },
        { agent: 'c', input: 'z' },
      ],
    });
    const ctx = new WorkflowContext({ task: {}, runStep, abortSignal: controller.signal });
    const results = await drain(runWorkflow(doc, ctx));
    // Only the first step should have run; loop exits before step 2.
    expect(stepsRun).toBe(1);
    expect(results).toHaveLength(1);
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
