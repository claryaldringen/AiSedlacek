import type { IEmailProvider } from '@ai-sedlacek/shared';
import { ConsoleEmailProvider } from './console-email';

let cached: IEmailProvider | null = null;

export function getEmailProvider(): IEmailProvider {
  if (cached) return cached;
  // Future: check process.env['EMAIL_PROVIDER'] for 'resend', 'sendgrid', etc.
  cached = new ConsoleEmailProvider();
  return cached;
}
