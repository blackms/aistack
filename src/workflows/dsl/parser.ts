/**
 * Workflow DSL parser — converts YAML/JSON string into a validated WorkflowDoc.
 *
 * YAML support is loaded dynamically: if neither `yaml` nor `js-yaml` is
 * installed, the parser falls back to JSON. This keeps the runtime dependency
 * footprint optional — users who only use JSON workflows pay nothing.
 */

import { z } from 'zod';
import { WorkflowDocSchema, type WorkflowDoc } from './schema.js';

/**
 * The DSL major.minor this runtime understands. Bump the major when a breaking
 * change is introduced (renamed/removed fields, semantic shift); bump minor
 * when adding backwards-compatible fields. The loader rejects docs with a
 * different major and warns on a higher same-major minor.
 */
export const SUPPORTED_DSL_VERSION = { major: 1, minor: 0 } as const;

/**
 * Custom parse error with human-friendly message.
 */
export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly issues?: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'WorkflowParseError';
  }
}

/**
 * Parse a `version` string like "1", "1.2", or "1.2.3" into {major, minor}.
 * Returns null if the string is not a recognised semver-ish form.
 */
function parseVersion(v: string): { major: number; minor: number } | null {
  const m = v.trim().match(/^(\d+)(?:\.(\d+))?(?:\.\d+)?$/);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: m[2] ? parseInt(m[2], 10) : 0 };
}

/**
 * Validate the `version` field on a parsed workflow document.
 *  - Unparseable version → WorkflowParseError
 *  - Major mismatch       → WorkflowParseError
 *  - Same major, higher minor than supported → console.warn (non-fatal)
 */
export function assertSupportedVersion(doc: WorkflowDoc): void {
  const parsed = parseVersion(doc.version);
  if (!parsed) {
    throw new WorkflowParseError(
      `Unsupported workflow version "${doc.version}". Expected a numeric version like "${SUPPORTED_DSL_VERSION.major}" or "${SUPPORTED_DSL_VERSION.major}.${SUPPORTED_DSL_VERSION.minor}".`
    );
  }
  if (parsed.major !== SUPPORTED_DSL_VERSION.major) {
    throw new WorkflowParseError(
      `Unsupported workflow DSL major version ${parsed.major} (this runtime understands major ${SUPPORTED_DSL_VERSION.major}). ` +
        `Upgrade the runtime or downgrade the workflow document.`
    );
  }
  if (parsed.minor > SUPPORTED_DSL_VERSION.minor) {
    // eslint-disable-next-line no-console
    console.warn(
      `[workflow] DSL version ${doc.version} is newer than this runtime (${SUPPORTED_DSL_VERSION.major}.${SUPPORTED_DSL_VERSION.minor}); some fields may be ignored.`
    );
  }
}

interface YamlModule {
  parse(input: string): unknown;
}

let cachedYaml: YamlModule | null = null;
let yamlResolved = false;

/**
 * Lazily load a YAML parser. Tries `yaml` first, then `js-yaml`.
 * Returns null if neither is installed.
 */
async function loadYaml(): Promise<YamlModule | null> {
  if (yamlResolved) return cachedYaml;
  yamlResolved = true;

  // Try `yaml` package (preferred — modern, well-typed)
  try {
    const mod = (await import('yaml')) as { parse?: (s: string) => unknown };
    if (typeof mod.parse === 'function') {
      cachedYaml = { parse: mod.parse };
      return cachedYaml;
    }
  } catch {
    /* fall through */
  }

  // Try `js-yaml` (load is the equivalent of parse)
  try {
    const mod = (await import('js-yaml')) as { load?: (s: string) => unknown };
    if (typeof mod.load === 'function') {
      cachedYaml = { parse: (s) => mod.load!(s) };
      return cachedYaml;
    }
  } catch {
    /* fall through */
  }

  return null;
}

/**
 * Heuristic: if the trimmed string starts with `{` or `[`, treat as JSON.
 */
function looksLikeJson(input: string): boolean {
  const trimmed = input.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/**
 * Parse a workflow definition.
 *
 * Accepts:
 *   - a YAML or JSON string
 *   - an already-parsed object (skips YAML/JSON parse)
 *
 * Throws `WorkflowParseError` on syntax errors or schema validation failures.
 */
export async function parseWorkflow(input: string | object): Promise<WorkflowDoc> {
  let raw: unknown;

  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      throw new WorkflowParseError('Workflow document is empty');
    }

    if (looksLikeJson(input)) {
      try {
        raw = JSON.parse(input);
      } catch (err) {
        throw new WorkflowParseError(
          `Invalid JSON: ${(err as Error).message}`,
          err
        );
      }
    } else {
      const yaml = await loadYaml();
      if (!yaml) {
        throw new WorkflowParseError(
          'YAML parser not available. Install the `yaml` package (npm install yaml) or supply a JSON workflow document.'
        );
      }
      try {
        raw = yaml.parse(input);
      } catch (err) {
        throw new WorkflowParseError(
          `Invalid YAML: ${(err as Error).message}`,
          err
        );
      }
    }
  } else {
    raw = input;
  }

  const result = WorkflowDocSchema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');
    throw new WorkflowParseError(
      `Workflow validation failed:\n${summary}`,
      result.error,
      result.error.issues
    );
  }

  assertSupportedVersion(result.data);
  return result.data;
}

/**
 * Synchronous parse for cases where the caller already has a parsed object
 * (e.g. JSON.parse'd config). Throws WorkflowParseError on schema failure.
 */
export function parseWorkflowObject(raw: unknown): WorkflowDoc {
  const result = WorkflowDocSchema.safeParse(raw);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');
    throw new WorkflowParseError(
      `Workflow validation failed:\n${summary}`,
      result.error,
      result.error.issues
    );
  }
  assertSupportedVersion(result.data);
  return result.data;
}
