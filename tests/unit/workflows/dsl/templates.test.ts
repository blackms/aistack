/**
 * Workflow DSL template guard tests.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  parseWorkflow,
  runWorkflow,
  WorkflowContext,
  type RunStepHook,
  type Step,
  type StepResult,
} from '../../../../src/workflows/dsl/index.js';

const m0TemplateUrl = new URL('../../../../templates/workflows/m0-agentic-tdd.yaml', import.meta.url);

function text(input: string | Record<string, unknown> | undefined): string {
  if (input === undefined) return '';
  return typeof input === 'string' ? input : JSON.stringify(input);
}

function flattenAgents(steps: Step[]): string[] {
  return steps.flatMap((step) => {
    if (step.parallel) return flattenAgents(step.parallel);
    return step.agent ? [step.agent] : [];
  });
}

function findTopLevelStep(steps: Step[], id: string): Step {
  const step = steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Missing step ${id}`);
  return step;
}

async function drain(gen: AsyncGenerator<StepResult>): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for await (const result of gen) out.push(result);
  return out;
}

describe('M0 agentic TDD workflow template', () => {
  it('codifies issue intake, red-first tests, implementation, and review loops', async () => {
    const doc = await parseWorkflow(readFileSync(m0TemplateUrl, 'utf8'));

    expect(doc.name).toBe('m0-agentic-tdd');
    expect(doc.description).toMatch(/M0/i);
    expect(doc.max_iterations).toBeGreaterThanOrEqual(40);

    const agents = new Set(flattenAgents(doc.steps));
    for (const agent of [
      'coordinator',
      'researcher',
      'architect',
      'tester',
      'coder',
      'adversarial',
      'reviewer',
      'documentation',
    ]) {
      expect(agents).toContain(agent);
    }

    const discovery = findTopLevelStep(doc.steps, 'issue-discovery');
    expect(discovery.parallel).toHaveLength(3);

    const redTests = findTopLevelStep(doc.steps, 'red-tests');
    expect(redTests.agent).toBe('tester');
    expect(text(redTests.input)).toMatch(/failing tests/i);
    expect(redTests.on_reject?.goto).toBe('test-plan');

    const implement = findTopLevelStep(doc.steps, 'implement');
    expect(implement.agent).toBe('coder');
    expect(text(implement.input)).toContain('$steps.red-tests.output');
    expect(text(implement.input)).toContain('$prev.output');

    const verify = findTopLevelStep(doc.steps, 'verify');
    expect(verify.agent).toBe('tester');
    expect(verify.on_reject?.goto).toBe('implement');
    expect(verify.on_reject?.max_retries).toBeGreaterThanOrEqual(3);
    expect(verify.on_reject?.fail_after).toBe(true);

    const adversarial = findTopLevelStep(doc.steps, 'adversarial-review');
    expect(adversarial.on_reject?.goto).toBe('implement');
    expect(text(adversarial.input)).toContain('$steps.verify.output');

    const peerReview = findTopLevelStep(doc.steps, 'peer-review');
    expect(peerReview.on_reject?.goto).toBe('implement');

    const docsAndStatus = findTopLevelStep(doc.steps, 'docs-and-status');
    expect(docsAndStatus.agent).toBe('documentation');
    expect(text(docsAndStatus.input)).toContain('$steps.peer-review.output');
  });

  it('loops failed verification and review back through implementation', async () => {
    const doc = await parseWorkflow(readFileSync(m0TemplateUrl, 'utf8'));
    let verifyCalls = 0;
    let adversarialCalls = 0;
    const implementInputs: string[] = [];

    const runStep: RunStepHook = vi.fn(async ({ stepId, agent, input }) => {
      if (stepId === 'implement') {
        implementInputs.push(input);
      }

      if (stepId === 'verify') {
        verifyCalls++;
        return {
          output: `verify-${verifyCalls}`,
          verdict: verifyCalls === 1 ? 'REJECT' : 'APPROVE',
        };
      }

      if (stepId === 'adversarial-review') {
        adversarialCalls++;
        return {
          output: `adversarial-${adversarialCalls}`,
          verdict: adversarialCalls === 1 ? 'REJECT' : 'APPROVE',
        };
      }

      if (stepId === 'red-tests' || stepId === 'peer-review') {
        return { output: `${stepId}-approved`, verdict: 'APPROVE' };
      }

      return { output: `${agent}:${stepId ?? 'parallel'}` };
    });

    const ctx = new WorkflowContext({
      task: {
        issue_id: 'AIG-631',
        input: 'Rewrite README positioning with TDD workflow guardrails',
      },
      runStep,
    });
    const results = await drain(runWorkflow(doc, ctx));

    expect(results.some((result) => result.error)).toBe(false);
    expect(results.filter((result) => result.id === 'implement')).toHaveLength(3);
    expect(results.filter((result) => result.id === 'verify')).toHaveLength(3);
    expect(results.filter((result) => result.id === 'adversarial-review')).toHaveLength(2);
    expect(implementInputs[1]).toContain('verify-1');
    expect(implementInputs[2]).toContain('adversarial-1');
    expect(results.at(-1)?.id).toBe('release-check');
  });
});
