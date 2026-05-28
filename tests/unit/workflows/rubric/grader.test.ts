/**
 * Tests for rubric grader engine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the spawner module BEFORE importing the grader
vi.mock('../../../../src/agents/spawner.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/agents/spawner.js')>(
    '../../../../src/agents/spawner.js'
  );
  return {
    ...actual,
    executeAgent: vi.fn(),
  };
});

import {
  gradeOutput,
  computeOverallScore,
  computePassed,
  parseScoreResponse,
  buildFixPrompt,
} from '../../../../src/workflows/rubric/grader.js';
import { parseRubric } from '../../../../src/workflows/rubric/parser.js';
import { executeAgent, clearAgents } from '../../../../src/agents/spawner.js';
import type { AgentStackConfig } from '../../../../src/types.js';
import type { CriterionScore, RubricDoc } from '../../../../src/workflows/rubric/schema.js';

const mockConfig: AgentStackConfig = {
  version: '1.0.0',
  memory: { path: ':memory:', defaultNamespace: 'test', vectorSearch: { enabled: false } },
  providers: { default: 'anthropic', anthropic: { apiKey: 'test' } },
  agents: { maxConcurrent: 5, defaultTimeout: 30000 } as any,
  github: { enabled: false } as any,
  plugins: { enabled: false, directory: '' } as any,
  mcp: { transport: 'stdio' } as any,
  hooks: { sessionStart: false, sessionEnd: false, preTask: false, postTask: false } as any,
};

const mockExec = executeAgent as unknown as ReturnType<typeof vi.fn>;

function score(c: string, s: number, w: number, passed: boolean): CriterionScore {
  return { criterion: c, score: s, justification: 'm', passed, weight: w };
}

describe('parseScoreResponse', () => {
  it('parses fenced JSON block', () => {
    const r = parseScoreResponse('Here is the score:\n```json\n{"score": 0.85, "justification": "good"}\n```');
    expect(r.score).toBe(0.85);
    expect(r.justification).toBe('good');
  });

  it('parses bare JSON', () => {
    const r = parseScoreResponse('{"score": 0.5, "justification": "meh"}');
    expect(r.score).toBe(0.5);
    expect(r.justification).toBe('meh');
  });

  it('clamps out-of-range scores to [0,1]', () => {
    expect(parseScoreResponse('{"score": 1.5, "justification": "x"}').score).toBe(1);
    expect(parseScoreResponse('{"score": -0.1, "justification": "x"}').score).toBe(0);
  });

  it('falls back to regex when JSON parse fails', () => {
    const r = parseScoreResponse('The score: 0.7 and justification: "partial"');
    expect(r.score).toBe(0.7);
  });

  it('defaults to score=0 on completely unparseable response', () => {
    const r = parseScoreResponse('this is just prose with no numbers');
    expect(r.score).toBe(0);
    expect(r.justification).toMatch(/Unparseable/);
  });
});

describe('computeOverallScore', () => {
  it('returns 0 for empty scores', () => {
    expect(computeOverallScore([])).toBe(0);
  });

  it('computes weighted average with absolute weights', () => {
    const scores = [score('a', 1.0, 0.4, true), score('b', 0.5, 0.6, true)];
    // (1.0*0.4 + 0.5*0.6) / (0.4+0.6) = (0.4 + 0.3) / 1.0 = 0.7
    expect(computeOverallScore(scores)).toBeCloseTo(0.7, 5);
  });

  it('normalises relative weights', () => {
    const scores = [score('a', 1.0, 4, true), score('b', 0.5, 6, true)];
    // (1.0*4 + 0.5*6) / 10 = 7/10 = 0.7
    expect(computeOverallScore(scores)).toBeCloseTo(0.7, 5);
  });

  it('clamps result to [0,1]', () => {
    const scores = [score('a', 1.0, 1, true)];
    expect(computeOverallScore(scores)).toBe(1);
  });
});

describe('computePassed', () => {
  const rubric: RubricDoc = parseRubric({
    name: 'r',
    overall_threshold: 0.8,
    rubric: [
      { criterion: 'a', weight: 0.5, pass_threshold: 0.7 },
      { criterion: 'b', weight: 0.5, pass_threshold: 0.9 },
    ],
  });

  it('passes when overall and per-criterion thresholds met', () => {
    const scores = [score('a', 0.8, 0.5, true), score('b', 0.95, 0.5, true)];
    expect(computePassed(rubric, scores, computeOverallScore(scores))).toBe(true);
  });

  it('fails when overall below threshold', () => {
    const scores = [score('a', 0.7, 0.5, true), score('b', 0.8, 0.5, true)];
    // overall = 0.75 < 0.8
    expect(computePassed(rubric, scores, computeOverallScore(scores))).toBe(false);
  });

  it('fails when any per-criterion threshold not met (even if overall high)', () => {
    const scores = [score('a', 1.0, 0.5, true), score('b', 0.8, 0.5, false)];
    // overall = 0.9 >= 0.8 but b.passed=false
    expect(computePassed(rubric, scores, computeOverallScore(scores))).toBe(false);
  });
});

describe('gradeOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAgents();
  });

  it('grades each criterion and aggregates a PASS', async () => {
    const rubric = parseRubric({
      name: 'pass-rubric',
      overall_threshold: 0.7,
      rubric: [
        { criterion: 'a', weight: 0.5, pass_threshold: 0.7 },
        { criterion: 'b', weight: 0.5, pass_threshold: 0.7 },
      ],
    });

    mockExec.mockImplementation(async (id: string, prompt: string) => {
      const isA = prompt.includes('Criterion: a');
      return {
        agentId: id,
        response: `\`\`\`json
{"score": ${isA ? 0.9 : 0.85}, "justification": "looks good"}
\`\`\``,
        model: 'mock',
        duration: 10,
      };
    });

    const result = await gradeOutput(rubric, 'def foo(): pass', mockConfig);
    expect(result.passed).toBe(true);
    expect(result.scores).toHaveLength(2);
    expect(result.overallScore).toBeCloseTo(0.875, 3);
    expect(result.scores.every((s) => s.passed)).toBe(true);
  });

  it('reports FAIL when a per-criterion threshold is missed', async () => {
    const rubric = parseRubric({
      name: 'fail-rubric',
      overall_threshold: 0.6,
      rubric: [
        { criterion: 'a', weight: 0.5, pass_threshold: 0.8 },
        { criterion: 'b', weight: 0.5, pass_threshold: 0.5 },
      ],
    });

    mockExec.mockImplementation(async (id: string, prompt: string) => {
      const isA = prompt.includes('Criterion: a');
      return {
        agentId: id,
        response: `{"score": ${isA ? 0.6 : 0.9}, "justification": "x"}`,
        model: 'mock',
        duration: 10,
      };
    });

    const result = await gradeOutput(rubric, 'output', mockConfig);
    expect(result.passed).toBe(false);
    expect(result.scores[0].passed).toBe(false); // a: 0.6 < 0.8
    expect(result.scores[1].passed).toBe(true);  // b: 0.9 >= 0.5
  });

  it('spawns one grader per criterion', async () => {
    const rubric = parseRubric({
      name: 'count-rubric',
      rubric: [
        { criterion: 'a' },
        { criterion: 'b' },
        { criterion: 'c' },
      ],
    });
    mockExec.mockResolvedValue({
      agentId: 'x',
      response: '{"score": 0.8, "justification": "ok"}',
      model: 'mock',
      duration: 5,
    });
    await gradeOutput(rubric, 'output', mockConfig);
    expect(mockExec).toHaveBeenCalledTimes(3);
  });

  it('includes original requirements in the criterion prompt when supplied', async () => {
    const rubric = parseRubric({
      name: 'req-rubric',
      rubric: [{ criterion: 'a' }],
    });
    mockExec.mockResolvedValue({
      agentId: 'x',
      response: '{"score": 1, "justification": "ok"}',
      model: 'mock',
      duration: 1,
    });
    await gradeOutput(rubric, 'output', mockConfig, { requirements: 'MUST handle nulls' });
    expect(mockExec).toHaveBeenCalled();
    const call = mockExec.mock.calls[0];
    expect(call[1]).toContain('MUST handle nulls');
  });

  it('builds a fix prompt highlighting failing criteria', async () => {
    const rubric = parseRubric({
      name: 'fix-rubric',
      rubric: [{ criterion: 'a', pass_threshold: 0.9 }],
    });
    mockExec.mockResolvedValue({
      agentId: 'x',
      response: '{"score": 0.5, "justification": "missing null check"}',
      model: 'mock',
      duration: 1,
    });
    const result = await gradeOutput(rubric, 'output', mockConfig);
    expect(result.passed).toBe(false);
    const fix = buildFixPrompt(result, 'output', 'reqs');
    expect(fix).toContain('missing null check');
    expect(fix).toContain('reqs');
  });
});
