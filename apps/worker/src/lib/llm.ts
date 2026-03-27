/**
 * Unified LLM message interface.
 *
 * When LLM_PROVIDER=claude-cli, calls the `claude` CLI instead of the Anthropic SDK.
 * This is useful for local testing without API credits.
 */

import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { getAnthropicClient } from './anthropic';

export interface LlmResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export function isCliMode(): boolean {
  return process.env.LLM_PROVIDER === 'claude-cli';
}

/**
 * Send a text-only message to Claude via SDK or CLI based on LLM_PROVIDER.
 */
export async function createMessage(params: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
}): Promise<LlmResponse> {
  if (isCliMode()) {
    return createMessageCli(params);
  }
  return createMessageApi(params);
}

async function createMessageApi(params: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
}): Promise<LlmResponse> {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens,
    ...(params.system ? { system: params.system } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    messages: params.messages,
  });

  return {
    text: response.content[0]?.type === 'text' ? response.content[0].text : '',
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/**
 * Spawn `claude` CLI and pipe the prompt via a temp file to avoid ARG_MAX limits.
 * System prompt uses --system-prompt-file for the same reason.
 */
async function createMessageCli(params: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<LlmResponse> {
  const userMessage = params.messages.filter((m) => m.role === 'user').pop();
  if (!userMessage) throw new Error('No user message provided');

  const tmpFiles: string[] = [];
  try {
    const args = ['--output-format', 'json', '--max-turns', '2'];

    // Write system prompt to file to avoid arg length issues
    if (params.system) {
      const sysFile = join(tmpdir(), `llm-sys-${randomUUID()}.txt`);
      await writeFile(sysFile, params.system);
      tmpFiles.push(sysFile);
      args.push('--system-prompt-file', sysFile);
    }

    // Write user prompt to file and pipe via stdin
    const promptFile = join(tmpdir(), `llm-prompt-${randomUUID()}.txt`);
    await writeFile(promptFile, userMessage.content);
    tmpFiles.push(promptFile);

    console.log('[CLI] Calling claude CLI...');
    const stdout = await spawnClaude(args, promptFile);

    const parsed = JSON.parse(stdout) as {
      result?: string;
      cost_usd?: number;
      duration_ms?: number;
      num_turns?: number;
    };

    console.log('[CLI] Done:', {
      cost_usd: parsed.cost_usd,
      duration_ms: parsed.duration_ms,
      num_turns: parsed.num_turns,
    });

    return {
      text: parsed.result ?? '',
      model: 'claude-cli',
      inputTokens: 0,
      outputTokens: 0,
    };
  } finally {
    await Promise.all(tmpFiles.map((f) => unlink(f).catch(() => {})));
  }
}

/**
 * Spawn claude CLI, piping the prompt file content via stdin.
 * Returns stdout. Rejects on non-zero exit or timeout.
 */
export function spawnClaude(args: string[], promptFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use shell to pipe the prompt file: cat promptFile | claude args
    const fullCmd = `cat "${promptFile}" | claude ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;

    // Run from /tmp so CLI doesn't discover project's CLAUDE.md
    const child = spawn('sh', ['-c', fullCmd], {
      env: { ...process.env },
      cwd: tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('claude CLI timed out after 5 minutes'));
    }, 300_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const detail = stderr.trim() || stdout.slice(0, 500);
        reject(new Error(`claude CLI exited with code ${code}: ${detail}`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
