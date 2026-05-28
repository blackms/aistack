/**
 * Rubric parser
 *
 * Accepts YAML text, JSON text, or an already-parsed object and validates it
 * against {@link RubricDocSchema}. The YAML reader is intentionally a small
 * subset (2-space-indented mappings + block sequences + scalars + `#` comments
 * + flow `[a, b]` arrays) — sufficient for rubric documents and avoids a hard
 * dependency on the `yaml` package, which is owned by the workflow DSL module.
 *
 * For complex YAML inputs callers can pre-parse with their preferred library
 * and pass the resulting object to {@link parseRubric}.
 */

import { RubricDocSchema, type RubricDoc } from './schema.js';

export type RubricInput = string | Record<string, unknown> | unknown;

/**
 * Detect input flavor and parse to a RubricDoc.
 *
 * @param input  YAML string, JSON string, or already-parsed object
 * @param format Optional explicit format hint ('yaml' | 'json' | 'object')
 */
export function parseRubric(input: RubricInput, format?: 'yaml' | 'json' | 'object'): RubricDoc {
  const raw = toObject(input, format);
  const result = RubricDocSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid rubric: ${issues}`);
  }
  return result.data;
}

function toObject(input: RubricInput, format?: 'yaml' | 'json' | 'object'): unknown {
  if (format === 'object' || (typeof input === 'object' && input !== null)) {
    return input;
  }
  if (typeof input !== 'string') {
    throw new Error('Rubric input must be a string or object');
  }
  const trimmed = input.trim();
  if (format === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Invalid JSON rubric: ${(err as Error).message}`);
    }
  }
  return parseYamlSubset(trimmed);
}

// ---------------------------------------------------------------------------
// Minimal YAML subset parser
// Supports: 2-space indented block mappings, block sequences ("- key: value"),
// scalars (string/number/bool/null), flow arrays ([a, b, "c"]), `#` comments,
// quoted strings. NOT supported: anchors, tags, multiline strings, complex
// flow maps. Sufficient for the rubric template format documented in
// docs/RUBRIC.md.
// ---------------------------------------------------------------------------

interface Line {
  indent: number;
  text: string;
  raw: string;
  num: number;
}

export function parseYamlSubset(text: string): unknown {
  const lines = preprocess(text);
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, 0);
  return value;
}

function preprocess(text: string): Line[] {
  const out: Line[] = [];
  const rawLines = text.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    // strip trailing comments (only when '#' is preceded by whitespace or starts the line,
    // and is not inside quotes)
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    const indent = countIndent(stripped);
    out.push({ indent, text: stripped.slice(indent), raw, num: i + 1 });
  }
  return out;
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '#' && !inSingle && !inDouble) {
      // require comment to be at start of line or after whitespace
      if (i === 0 || /\s/.test(line[i - 1])) {
        return line.slice(0, i).replace(/\s+$/, '');
      }
    }
  }
  return line.replace(/\s+$/, '');
}

function countIndent(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === ' ') n++;
  return n;
}

// Returns [value, nextIndex]
function parseBlock(lines: Line[], start: number, indent: number): [unknown, number] {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (first.indent < indent) return [null, start];
  if (first.text.startsWith('- ') || first.text === '-') {
    return parseSequence(lines, start, first.indent);
  }
  return parseMapping(lines, start, first.indent);
}

function parseMapping(lines: Line[], start: number, indent: number): [Record<string, unknown>, number] {
  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`YAML parse error at line ${line.num}: unexpected indent`);
    }
    const text = line.text;
    if (text.startsWith('- ')) {
      throw new Error(`YAML parse error at line ${line.num}: sequence item inside mapping`);
    }
    const colonIdx = findColon(text);
    if (colonIdx === -1) {
      throw new Error(`YAML parse error at line ${line.num}: expected 'key: value'`);
    }
    const key = unquote(text.slice(0, colonIdx).trim());
    const after = text.slice(colonIdx + 1).trim();
    i++;
    if (after === '' || after === '|' || after === '>') {
      // child block
      if (i < lines.length && lines[i].indent > indent) {
        const [child, next] = parseBlock(lines, i, lines[i].indent);
        obj[key] = child;
        i = next;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalarOrFlow(after);
    }
  }
  return [obj, i];
}

function parseSequence(lines: Line[], start: number, indent: number): [unknown[], number] {
  const arr: unknown[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new Error(`YAML parse error at line ${line.num}: unexpected indent in sequence`);
    }
    if (!line.text.startsWith('- ') && line.text !== '-') break;
    const remainder = line.text === '-' ? '' : line.text.slice(2);
    if (remainder === '') {
      // child block on next line(s)
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const [child, next] = parseBlock(lines, i, lines[i].indent);
        arr.push(child);
        i = next;
      } else {
        arr.push(null);
      }
      continue;
    }
    // inline: could be scalar or "key: value" start of inline mapping
    const colonIdx = findColon(remainder);
    if (colonIdx === -1) {
      arr.push(parseScalarOrFlow(remainder));
      i++;
      continue;
    }
    // build a mini-mapping starting with this inline pair, plus any continuation
    // lines indented further than the dash.
    const key = unquote(remainder.slice(0, colonIdx).trim());
    const after = remainder.slice(colonIdx + 1).trim();
    const obj: Record<string, unknown> = {};
    if (after !== '') {
      obj[key] = parseScalarOrFlow(after);
    } else {
      obj[key] = null;
    }
    i++;
    // child indent is indent + 2 (dash takes 2 cols)
    const childIndent = indent + 2;
    while (i < lines.length && lines[i].indent > indent && !lines[i].text.startsWith('- ')) {
      const cont = lines[i];
      if (cont.indent !== childIndent) {
        // deeper indent -> belongs to previous key's child block
        if (cont.indent > childIndent) {
          const lastKey = Object.keys(obj).at(-1);
          if (lastKey == null || obj[lastKey] !== null) {
            throw new Error(`YAML parse error at line ${cont.num}: unexpected indent`);
          }
          const [child, next] = parseBlock(lines, i, cont.indent);
          obj[lastKey] = child;
          i = next;
          continue;
        }
        break;
      }
      const cText = cont.text;
      const cColon = findColon(cText);
      if (cColon === -1) {
        throw new Error(`YAML parse error at line ${cont.num}: expected 'key: value'`);
      }
      const cKey = unquote(cText.slice(0, cColon).trim());
      const cAfter = cText.slice(cColon + 1).trim();
      i++;
      if (cAfter === '') {
        if (i < lines.length && lines[i].indent > childIndent) {
          const [child, next] = parseBlock(lines, i, lines[i].indent);
          obj[cKey] = child;
          i = next;
        } else {
          obj[cKey] = null;
        }
      } else {
        obj[cKey] = parseScalarOrFlow(cAfter);
      }
    }
    arr.push(obj);
  }
  return [arr, i];
}

function findColon(text: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === ':' && !inSingle && !inDouble) {
      // colon must be followed by space or be at end of line
      if (i === text.length - 1 || text[i + 1] === ' ') return i;
    }
  }
  return -1;
}

function parseScalarOrFlow(text: string): unknown {
  const t = text.trim();
  if (t === '') return null;
  if (t.startsWith('[') && t.endsWith(']')) {
    return parseFlowArray(t);
  }
  return parseScalar(t);
}

function parseFlowArray(text: string): unknown[] {
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (!inSingle && !inDouble) {
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(buf.trim());
        buf = '';
        continue;
      }
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf.trim());
  return parts.map((p) => parseScalarOrFlow(p));
}

function parseScalar(text: string): unknown {
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return parseFloat(text);
  return unquote(text);
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = text.slice(1, -1);
      if (first === '"') {
        return inner.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      return inner.replace(/''/g, "'");
    }
  }
  return text;
}
