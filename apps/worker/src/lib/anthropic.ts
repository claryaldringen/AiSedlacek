import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/** Shared Anthropic client instance (singleton). */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
