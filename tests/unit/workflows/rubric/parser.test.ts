/**
 * Tests for rubric parser (YAML subset + JSON + object).
 */

import { describe, it, expect } from 'vitest';
import { parseRubric, parseYamlSubset } from '../../../../src/workflows/rubric/parser.js';

describe('parseRubric', () => {
  const validYaml = `version: 1
name: code-quality
description: Test rubric
overall_threshold: 0.8
max_iterations: 3
rubric:
  - criterion: correctness
    description: Does the code work?
    weight: 0.4
    pass_threshold: 0.8
  - criterion: security
    weight: 0.3
    pass_threshold: 0.9
  - criterion: docs
    weight: 0.3
    pass_threshold: 0.7
`;

  it('parses a valid YAML rubric', () => {
    const doc = parseRubric(validYaml);
    expect(doc.name).toBe('code-quality');
    expect(doc.rubric).toHaveLength(3);
    expect(doc.rubric[0].criterion).toBe('correctness');
    expect(doc.rubric[0].weight).toBe(0.4);
    expect(doc.rubric[0].pass_threshold).toBe(0.8);
    expect(doc.overall_threshold).toBe(0.8);
    expect(doc.max_iterations).toBe(3);
  });

  it('parses a valid JSON rubric', () => {
    const json = JSON.stringify({
      name: 'json-rubric',
      rubric: [{ criterion: 'foo', weight: 1.0 }],
    });
    const doc = parseRubric(json);
    expect(doc.name).toBe('json-rubric');
    expect(doc.rubric[0].criterion).toBe('foo');
  });

  it('parses an already-parsed object', () => {
    const obj = {
      name: 'obj',
      rubric: [{ criterion: 'a', weight: 2 }, { criterion: 'b', weight: 1 }],
    };
    const doc = parseRubric(obj);
    expect(doc.rubric).toHaveLength(2);
    // defaults applied
    expect(doc.overall_threshold).toBe(0.8);
    expect(doc.max_iterations).toBe(3);
  });

  it('applies default weight of 1.0 when omitted', () => {
    const doc = parseRubric({
      name: 'defaults',
      rubric: [{ criterion: 'only' }],
    });
    expect(doc.rubric[0].weight).toBe(1.0);
  });

  it('rejects an empty rubric array', () => {
    expect(() =>
      parseRubric({ name: 'empty', rubric: [] })
    ).toThrow(/at least one criterion/);
  });

  it('rejects a missing name', () => {
    expect(() =>
      parseRubric({ rubric: [{ criterion: 'x' }] })
    ).toThrow(/Invalid rubric/);
  });

  it('rejects an out-of-range pass_threshold', () => {
    expect(() =>
      parseRubric({
        name: 'bad',
        rubric: [{ criterion: 'x', pass_threshold: 1.5 }],
      })
    ).toThrow(/Invalid rubric/);
  });

  it('rejects a non-positive weight', () => {
    expect(() =>
      parseRubric({
        name: 'bad',
        rubric: [{ criterion: 'x', weight: 0 }],
      })
    ).toThrow(/Invalid rubric/);
  });

  it('rejects malformed JSON input', () => {
    expect(() => parseRubric('{not json')).toThrow();
  });

  it('handles YAML comments and blank lines', () => {
    const yamlWithComments = `# top-level comment
name: with-comments

# another comment
rubric:
  - criterion: a  # inline comment
    weight: 1
`;
    const doc = parseRubric(yamlWithComments);
    expect(doc.name).toBe('with-comments');
    expect(doc.rubric[0].criterion).toBe('a');
  });

  it('parses flow arrays in checks field', () => {
    const doc = parseRubric({
      name: 'flow',
      rubric: [
        { criterion: 'x', checks: ['check1', 'check2', 'check3'] },
      ],
    });
    expect(doc.rubric[0].checks).toEqual(['check1', 'check2', 'check3']);
  });
});

describe('parseYamlSubset', () => {
  it('parses simple key/value pairs', () => {
    const result = parseYamlSubset('a: 1\nb: hello\nc: true\n');
    expect(result).toEqual({ a: 1, b: 'hello', c: true });
  });

  it('parses nested mappings', () => {
    const result = parseYamlSubset('a:\n  b: 1\n  c: 2\n');
    expect(result).toEqual({ a: { b: 1, c: 2 } });
  });

  it('parses block sequences with inline mappings', () => {
    const result = parseYamlSubset('items:\n  - name: one\n    value: 1\n  - name: two\n    value: 2\n');
    expect(result).toEqual({
      items: [
        { name: 'one', value: 1 },
        { name: 'two', value: 2 },
      ],
    });
  });

  it('parses quoted strings preserving spaces', () => {
    const result = parseYamlSubset('greeting: "hello world"\n');
    expect(result).toEqual({ greeting: 'hello world' });
  });

  it('parses flow arrays', () => {
    const result = parseYamlSubset('list: [a, b, c]\n');
    expect(result).toEqual({ list: ['a', 'b', 'c'] });
  });

  it('parses null and boolean scalars', () => {
    const result = parseYamlSubset('a: null\nb: ~\nc: true\nd: false\n');
    expect(result).toEqual({ a: null, b: null, c: true, d: false });
  });
});
