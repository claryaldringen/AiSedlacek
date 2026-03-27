/**
 * Unified LLM message interface.
 *
 * When LLM_PROVIDER=claude-cli, calls the `claude` CLI instead of the Anthropic SDK.
 * This is useful for local testing without API credits.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getAnthropicClient } from './anthropic';

const execFileAsync = promisify(execFile);

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

async function createMessageCli(params: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<LlmResponse> {
  const userMessage = params.messages.filter((m) => m.role === 'user').pop();
  if (!userMessage) throw new Error('No user message provided');

  const args = ['--bare', '-p', userMessage.content, '--output-format', 'json', '--max-turns', '1'];

  if (params.system) {
    args.push('--system-prompt', params.system);
  }

  console.log('[CLI] Calling claude CLI...');
  const { stdout } = await execFileAsync('claude', args, {
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env },
  });

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
}
