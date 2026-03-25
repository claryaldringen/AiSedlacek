import type { IEmailProvider } from '@ai-sedlacek/shared';
import { ConsoleEmailProvider } from './console-email';

let cached: IEmailProvider | null = null;

export function getEmailProvider(): IEmailProvider {
  if (cached) return cached;
  if (process.env['RESEND_API_KEY']) {
    // Lazy import to avoid loading Resend in dev without API key
    const { ResendEmailProvider } = require('./resend-email') as typeof import('./resend-email');
    cached = new ResendEmailProvider();
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}
