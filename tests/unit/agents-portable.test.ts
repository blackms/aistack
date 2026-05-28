/**
 * Unit tests for the portable agent file format.
 *
 * These tests are pure: no memory manager, no identity service. The
 * integration test (`tests/integration/agents-portable.test.ts`) covers
 * the full export-from-identity / import-into-store round-trip.
 */

import { describe, it, expect } from 'vitest';
import {
  computeIntegrity,
  exportAgentByType,
  parse,
  serialize,
  validatePortableFile,
  verifyIntegrity,
  importLettaAf,
} from '../../src/agents/portable.js';
import {
  IncompatibleFileVersionError,
  PORTABLE_FORMAT_VERSION,
  PORTABLE_MAGIC,
  stripSecrets,
} from '../../src/agents/portable-schema.js';
import {
  serializeBundleBuffer,
  parseBundleBuffer,
} from '../../src/agents/portable-bundle.js';

describe('PortableAgentFile schema', () => {
  it('exportAgentByType produces a valid file for every core type', () => {
    const types = ['coder', 'researcher', 'tester', 'reviewer', 'architect'];
    for (const t of types) {
      const file = exportAgentByType(t);
      expect(file.magic).toBe(PORTABLE_MAGIC);
      expect(file.format_version).toBe(PORTABLE_FORMAT_VERSION);
      expect(file.agent.type).toBe(t);
      expect(file.memory_snapshot.entries_count).toBe(0);
      expect(file.memory_snapshot.entries).toEqual([]);
    }
  });

  it('exportAgentByType throws for unknown type', () => {
    expect(() => exportAgentByType('not-a-real-agent')).toThrow(/Unknown agent type/);
  });

  it('serialize -> parse is a pure round-trip (modulo exported_at)', () => {
    const file = exportAgentByType('coder', { labels: ['template', 'unit-test'] });
    const text = serialize(file);
    const parsed = parse(text);
    expect(parsed).toEqual(file);
  });

  it('validatePortableFile rejects unknown top-level keys', () => {
    const file = exportAgentByType('coder');
    const tampered: Record<string, unknown> = { ...file, extra: 'nope' };
    expect(() => validatePortableFile(tampered)).toThrow();
  });

  it('validatePortableFile rejects wrong magic', () => {
    const file = exportAgentByType('coder');
    expect(() =>
      validatePortableFile({ ...file, magic: 'something-else' })
    ).toThrow();
  });

  it('validatePortableFile rejects malformed format_version', () => {
    const file = exportAgentByType('coder');
    expect(() =>
      validatePortableFile({ ...file, format_version: 'v1' })
    ).toThrow();
  });

  it('validatePortableFile accepts an entry-bearing snapshot', () => {
    const file = exportAgentByType('coder');
    const withEntries = {
      ...file,
      memory_snapshot: {
        format: 'json-entries' as const,
        entries_count: 1,
        entries: [
          {
            key: 'k1',
            namespace: 'ns',
            content: 'hello',
            tags: ['a', 'b'],
            metadata: { x: 1 },
          },
        ],
      },
    };
    const out = validatePortableFile(withEntries);
    expect(out.memory_snapshot.entries).toHaveLength(1);
  });
});

describe('stripSecrets', () => {
  it('removes well-known secret keys at top level', () => {
    const cleaned = stripSecrets({
      apiKey: 'sk-xxx',
      token: 'jwt',
      keep: 'me',
    });
    expect(cleaned).toEqual({ keep: 'me' });
  });

  it('removes secrets nested one level deep', () => {
    const cleaned = stripSecrets({
      provider: { name: 'anthropic', apiKey: 'sk-xxx', model: 'opus' },
    });
    expect(cleaned).toEqual({
      provider: { name: 'anthropic', model: 'opus' },
    });
  });

  it('returns undefined unchanged', () => {
    expect(stripSecrets(undefined)).toBeUndefined();
  });
});

describe('Bundle serialization (json / tgz)', () => {
  it('json round-trip preserves all fields', () => {
    const file = exportAgentByType('reviewer', { labels: ['baseline'] });
    const buf = serializeBundleBuffer(file, 'json');
    const parsed = parseBundleBuffer(buf);
    expect(parsed).toEqual(file);
  });

  it('gzip round-trip preserves all fields', () => {
    const file = exportAgentByType('architect', { labels: ['compressed'] });
    const buf = serializeBundleBuffer(file, 'tgz');
    // Gzip magic bytes
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);
    const parsed = parseBundleBuffer(buf);
    expect(parsed).toEqual(file);
  });

  it('parseBundleBuffer auto-detects gzip vs plain JSON', () => {
    const file = exportAgentByType('coder');
    const gzipped = serializeBundleBuffer(file, 'tgz');
    const plain = serializeBundleBuffer(file, 'json');
    expect(parseBundleBuffer(gzipped)).toEqual(file);
    expect(parseBundleBuffer(plain)).toEqual(file);
  });
});

describe('importLettaAf (best-effort)', () => {
  it('maps a minimal Letta .af to a valid PortableAgentFile', () => {
    const lettaAf = {
      id: 'letta-uuid-1',
      agent_type: 'memgpt_agent',
      name: 'my-letta-agent',
      system: 'You are a Letta agent.',
      llm_config: { model: 'gpt-4o' },
      tools: [{ name: 'send_message' }, { name: 'archival_memory_search' }],
      core_memory: [
        { label: 'persona', value: 'I am helpful' },
        { label: 'human', value: 'User is testing' },
      ],
    };

    const portable = importLettaAf(lettaAf);

    expect(portable.magic).toBe(PORTABLE_MAGIC);
    expect(portable.agent.type).toBe('coder'); // mapped from memgpt_agent
    expect(portable.agent.name).toBe('my-letta-agent');
    expect(portable.agent.system_prompt_override).toBe('You are a Letta agent.');
    expect(portable.agent.model).toBe('gpt-4o');
    expect(portable.agent.tool_whitelist).toContain('Reply');
    expect(portable.agent.tool_whitelist).toContain('Memory.search');
    expect(portable.memory_snapshot.entries_count).toBe(2);
    expect(portable.memory_snapshot.entries[0].namespace).toBe('letta-imported');
    expect(portable.metadata.source?.tool).toBe('letta');
    expect(portable.metadata.source?.original_id).toBe('letta-uuid-1');
  });

  it('records a warning label for unknown agent_type', () => {
    const portable = importLettaAf({
      agent_type: 'totally_unknown_type',
      name: 'x',
      core_memory: [],
      tools: [],
    });
    expect(portable.agent.type).toBe('coder'); // fallback
    expect(portable.metadata.labels?.[0]).toMatch(/letta:warn:unknown-type/);
  });

  it('handles missing optional fields gracefully', () => {
    const portable = importLettaAf({ agent_type: 'chat_agent' });
    expect(portable.agent.type).toBe('coder');
    expect(portable.agent.name).toMatch(/letta-chat_agent/);
    expect(portable.memory_snapshot.entries_count).toBe(0);
    expect(portable.agent.tool_whitelist).toBeUndefined();
  });

  it('throws on non-object input', () => {
    expect(() => importLettaAf('not an object')).toThrow(/expected a JSON object/);
    expect(() => importLettaAf(null)).toThrow(/expected a JSON object/);
  });

  it('strips secret-looking keys from core_memory block metadata', () => {
    const portable = importLettaAf({
      agent_type: 'memgpt_agent',
      name: 'leaky',
      core_memory: [
        {
          label: 'persona',
          value: 'I am helpful',
          // simulate a malicious or careless Letta export that smuggled
          // a credential into the block alongside its normal attributes
          apiKey: 'sk-should-be-stripped',
          limit: 4000,
        },
      ],
    });
    const entry = portable.memory_snapshot.entries[0];
    expect(entry.metadata).toBeDefined();
    expect(entry.metadata).not.toHaveProperty('apiKey');
    expect(entry.metadata?.limit).toBe(4000);
  });
});

describe('Major-version gate (validatePortableFile)', () => {
  it('accepts the same major with a higher minor (backward-compatible)', () => {
    const file = exportAgentByType('coder');
    const future = { ...file, format_version: '1.99', integrity: null };
    expect(() => validatePortableFile(future)).not.toThrow();
  });

  it('rejects a future major version with IncompatibleFileVersionError', () => {
    const file = exportAgentByType('coder');
    const v2 = { ...file, format_version: '2.0', integrity: null };
    expect(() => validatePortableFile(v2)).toThrow(IncompatibleFileVersionError);
  });

  it('rejects an older major version with IncompatibleFileVersionError', () => {
    const file = exportAgentByType('coder');
    const v0 = { ...file, format_version: '0.9', integrity: null };
    expect(() => validatePortableFile(v0)).toThrow(IncompatibleFileVersionError);
  });
});

describe('Bundle integrity (sha256)', () => {
  it('exportAgentByType stamps a sha256 integrity digest', () => {
    const file = exportAgentByType('coder', { labels: ['integrity-test'] });
    expect(file.integrity).toBeDefined();
    expect(file.integrity?.algo).toBe('sha256');
    expect(file.integrity?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('integrity digest is deterministic across exports of the same data', () => {
    const a = exportAgentByType('coder', { labels: ['x'] });
    const b: typeof a = {
      ...a,
      metadata: { ...a.metadata, exported_at: a.metadata.exported_at },
    };
    expect(computeIntegrity(a).digest).toBe(computeIntegrity(b).digest);
  });

  it('verifyIntegrity accepts an untampered bundle', () => {
    const file = exportAgentByType('reviewer');
    expect(() => verifyIntegrity(file)).not.toThrow();
  });

  it('verifyIntegrity detects content tampering', () => {
    const file = exportAgentByType('reviewer');
    const tampered: typeof file = {
      ...file,
      agent: { ...file.agent, name: 'hijacked' },
    };
    expect(() => verifyIntegrity(tampered)).toThrow(/integrity check failed/);
  });

  it('verifyIntegrity is a no-op when no integrity field is present', () => {
    const file = exportAgentByType('coder');
    const stripped: typeof file = { ...file, integrity: null };
    expect(() => verifyIntegrity(stripped)).not.toThrow();
  });

  it('round-trips losslessly through serialize/parse with integrity intact', () => {
    const file = exportAgentByType('architect');
    const reparsed = parse(serialize(file));
    expect(reparsed.integrity).toEqual(file.integrity);
    expect(() => verifyIntegrity(reparsed)).not.toThrow();
  });
});

describe('Lossless tool_whitelist / model round-trip', () => {
  it('Letta import -> serialize -> parse preserves tool_whitelist and model', () => {
    const portable = importLettaAf({
      agent_type: 'memgpt_agent',
      name: 'roundtrip-agent',
      llm_config: { model: 'claude-opus-4-7' },
      tools: [{ name: 'send_message' }, { name: 'custom_tool' }],
    });
    expect(portable.agent.tool_whitelist).toContain('Reply');
    expect(portable.agent.tool_whitelist).toContain('custom_tool');
    expect(portable.agent.model).toBe('claude-opus-4-7');

    const text = serialize(portable);
    const reparsed = parse(text);
    expect(reparsed.agent.tool_whitelist).toEqual(portable.agent.tool_whitelist);
    expect(reparsed.agent.model).toBe(portable.agent.model);
  });
});
