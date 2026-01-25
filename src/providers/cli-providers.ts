/**
 * CLI-based LLM providers
 *
 * Providers that execute external CLI tools like Claude Code, Gemini CLI, and Codex
 */

import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from '../types.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);
const log = logger.child('cli-providers');

/**
 * Format chat messages into a single prompt string
 */
function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => {
      switch (m.role) {
        case 'system':
          return `System: ${m.content}`;
        case 'user':
          return `User: ${m.content}`;
        case 'assistant':
          return `Assistant: ${m.content}`;
        default:
          return m.content;
      }
    })
    .join('\n\n');
}

/**
 * Escape string for shell command
 */
function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Claude Code CLI Provider
 *
 * Uses the `claude` CLI tool for chat completions.
 * Install: npm install -g @anthropic-ai/claude-code
 */
export class ClaudeCodeProvider implements LLMProvider {
  name = 'claude-code';
  private command: string;
  private model: string;
  private timeout: number;

  constructor(options?: { command?: string; model?: string; timeout?: number }) {
    this.command = options?.command ?? 'claude';
    this.model = options?.model ?? 'sonnet';
    this.timeout = options?.timeout ?? 300000; // 5 minutes default
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const prompt = formatMessages(messages);
    const model = options?.model ?? this.model;

    log.debug('Executing Claude Code CLI', { model, promptLength: prompt.length });

    try {
      // Use --print flag for non-interactive output
      const command = `echo '${escapeShell(prompt)}' | ${this.command} --print --model ${model}`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stderr) {
        log.warn('Claude Code CLI stderr', { stderr });
      }

      return {
        content: stdout.trim(),
        model: `claude-code:${model}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Claude Code CLI failed', { error: message });
      throw new Error(`Claude Code CLI error: ${message}`);
    }
  }

  /**
   * Check if Claude Code CLI is available
   */
  isAvailable(): boolean {
    try {
      execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the CLI version
   */
  getVersion(): string | null {
    try {
      const result = execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return result.trim();
    } catch {
      return null;
    }
  }
}

/**
 * Gemini CLI Provider
 *
 * Uses the `gemini` CLI tool for chat completions.
 * Install: pip install google-generativeai
 */
export class GeminiCLIProvider implements LLMProvider {
  name = 'gemini-cli';
  private command: string;
  private model: string;
  private timeout: number;

  constructor(options?: { command?: string; model?: string; timeout?: number }) {
    this.command = options?.command ?? 'gemini';
    this.model = options?.model ?? 'gemini-2.0-flash';
    this.timeout = options?.timeout ?? 120000; // 2 minutes default
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const prompt = formatMessages(messages);
    const model = options?.model ?? this.model;

    log.debug('Executing Gemini CLI', { model, promptLength: prompt.length });

    try {
      // Gemini CLI syntax may vary - adjust based on actual CLI
      const command = `echo '${escapeShell(prompt)}' | ${this.command} --model ${model}`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (stderr) {
        log.warn('Gemini CLI stderr', { stderr });
      }

      return {
        content: stdout.trim(),
        model: `gemini-cli:${model}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Gemini CLI failed', { error: message });
      throw new Error(`Gemini CLI error: ${message}`);
    }
  }

  /**
   * Check if Gemini CLI is available
   */
  isAvailable(): boolean {
    try {
      execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the CLI version
   */
  getVersion(): string | null {
    try {
      const result = execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return result.trim();
    } catch {
      return null;
    }
  }
}

/**
 * Codex CLI Provider
 *
 * Uses the `codex` CLI tool for code completions.
 */
export class CodexProvider implements LLMProvider {
  name = 'codex';
  private command: string;
  private timeout: number;

  constructor(options?: { command?: string; timeout?: number }) {
    this.command = options?.command ?? 'codex';
    this.timeout = options?.timeout ?? 300000; // 5 minutes default
  }

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<ChatResponse> {
    const prompt = formatMessages(messages);

    log.debug('Executing Codex CLI', { promptLength: prompt.length });

    try {
      // Use codex exec for non-interactive execution with --json for structured output
      // and -o to capture the last message
      const tempFile = `/tmp/codex-output-${Date.now()}.txt`;
      const command = `${this.command} exec -o ${tempFile} '${escapeShell(prompt)}'`;

      const { stdout, stderr } = await execAsync(command, {
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      if (stderr) {
        log.warn('Codex CLI stderr', { stderr });
      }

      // Try to read the output file, fall back to stdout
      let content = stdout.trim();
      try {
        const fs = await import('node:fs');
        if (fs.existsSync(tempFile)) {
          content = fs.readFileSync(tempFile, 'utf-8').trim();
          fs.unlinkSync(tempFile);
        }
      } catch {
        // Ignore file read errors, use stdout
      }

      return {
        content,
        model: 'codex-cli',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('Codex CLI failed', { error: message });
      throw new Error(`Codex CLI error: ${message}`);
    }
  }

  /**
   * Check if Codex CLI is available
   */
  isAvailable(): boolean {
    try {
      execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the CLI version
   */
  getVersion(): string | null {
    try {
      const result = execSync(`${this.command} --version`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: 'pipe',
      });
      return result.trim();
    } catch {
      return null;
    }
  }
}

/**
 * Check availability of all CLI providers
 */
export function checkCLIProviders(): {
  claude_code: boolean;
  gemini_cli: boolean;
  codex: boolean;
} {
  return {
    claude_code: new ClaudeCodeProvider().isAvailable(),
    gemini_cli: new GeminiCLIProvider().isAvailable(),
    codex: new CodexProvider().isAvailable(),
  };
}
