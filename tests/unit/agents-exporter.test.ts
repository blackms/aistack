/**
 * Unit tests for the agent → Claude Code subagent markdown exporter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  exportAgentToMarkdown,
  exportAllAgents,
  AGENT_NAME_PREFIX,
} from '../../src/agents/exporter.js';
import { getAgentDefinition } from '../../src/agents/registry.js';
import type { AgentDefinition } from '../../src/types.js';

/** Parse a `---\n...\n---` frontmatter block into a flat key→string map. */
function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error('No frontmatter block found');
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

describe('exportAgentToMarkdown', () => {
  it('emits frontmatter with required Claude Code subagent fields', () => {
    const coder = getAgentDefinition('coder');
    expect(coder).not.toBeNull();
    const md = exportAgentToMarkdown(coder!);

    const fm = parseFrontmatter(md);
    expect(fm.name).toBe(`${AGENT_NAME_PREFIX}coder`);
    expect(fm.model).toBe('sonnet');
    expect(fm.color).toBe('blue');
    // description must be a quoted YAML string
    expect(fm.description.startsWith('"')).toBe(true);
    expect(fm.description.endsWith('"')).toBe(true);
    // tools must be a flow-sequence list containing common dev tools
    expect(fm.tools).toMatch(/^\[.*Read.*Edit.*Bash.*\]$/);
  });

  it('uses opus for deep-reasoning agents (security-auditor, architect, adversarial)', () => {
    for (const type of ['security-auditor', 'architect', 'adversarial', 'coordinator']) {
      const def = getAgentDefinition(type);
      expect(def, `missing definition: ${type}`).not.toBeNull();
      const fm = parseFrontmatter(exportAgentToMarkdown(def!));
      expect(fm.model, `model for ${type}`).toBe('opus');
    }
  });

  it('includes the agent system prompt verbatim in the body', () => {
    const reviewer = getAgentDefinition('reviewer');
    expect(reviewer).not.toBeNull();
    const md = exportAgentToMarkdown(reviewer!);

    // The body should contain a distinctive snippet from the prompt.
    // We pull a window of text and assert containment instead of equality
    // so the test is robust to wording tweaks in the source definition.
    const promptSnippet = reviewer!.systemPrompt.slice(0, 40);
    expect(md).toContain(promptSnippet);
  });

  it('forbids hooks/mcpServers/permissionMode frontmatter keys', () => {
    const def = getAgentDefinition('coder')!;
    const md = exportAgentToMarkdown(def);
    const fm = parseFrontmatter(md);
    expect(fm.hooks).toBeUndefined();
    expect(fm.mcpServers).toBeUndefined();
    expect(fm.permissionMode).toBeUndefined();
  });

  it('honors per-agent profile overrides', () => {
    const def = getAgentDefinition('coder')!;
    const md = exportAgentToMarkdown(def, {
      profiles: { coder: { model: 'haiku', color: 'pink', tools: ['Read'] } },
    });
    const fm = parseFrontmatter(md);
    expect(fm.model).toBe('haiku');
    expect(fm.color).toBe('pink');
    expect(fm.tools).toBe('[Read]');
  });

  it('YAML-escapes embedded quotes in description', () => {
    const synthetic: AgentDefinition = {
      type: 'coder', // reuse a known profile so we get a model/color
      name: 'Synthetic',
      description: 'A "quoted" description with: colon',
      systemPrompt: 'body',
      capabilities: [],
    };
    const md = exportAgentToMarkdown(synthetic);
    const fm = parseFrontmatter(md);
    // Quote inside description must be backslash-escaped, and the whole
    // string must remain double-quoted at the YAML level.
    expect(fm.description).toContain('\\"quoted\\"');
  });
});

describe('exportAllAgents', () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'aistack-export-'));
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes one markdown file per registered core agent (12 total)', async () => {
    const written = await exportAllAgents(outDir);
    expect(written.length).toBe(12);

    const files = await readdir(outDir);
    expect(files.length).toBe(12);
    for (const file of files) {
      expect(file.startsWith(AGENT_NAME_PREFIX)).toBe(true);
      expect(file.endsWith('.md')).toBe(true);
    }
  });

  it('produces files invocable as @aistack-<type> in Claude Code', async () => {
    await exportAllAgents(outDir);
    const expectedTypes = [
      'coder',
      'researcher',
      'tester',
      'reviewer',
      'adversarial',
      'architect',
      'coordinator',
      'analyst',
      'devops',
      'documentation',
      'security-auditor',
      'grader',
    ];
    for (const type of expectedTypes) {
      const content = await readFile(
        join(outDir, `${AGENT_NAME_PREFIX}${type}.md`),
        'utf8',
      );
      const fm = parseFrontmatter(content);
      expect(fm.name).toBe(`${AGENT_NAME_PREFIX}${type}`);
    }
  });

  it('creates the output directory if it does not exist', async () => {
    const nested = join(outDir, 'nested', 'agents');
    const written = await exportAllAgents(nested);
    expect(written.length).toBe(12);
    const files = await readdir(nested);
    expect(files.length).toBe(12);
  });
});
