import type { IEmailProvider } from '@ai-sedlacek/shared';
import { ConsoleEmailProvider } from './console-email';

let cached: IEmailProvider | null = null;

export async function getEmailProvider(): Promise<IEmailProvider> {
  if (cached) return cached;
  if (process.env['RESEND_API_KEY']) {
    const { ResendEmailProvider } = await import('./resend-email');
    cached = new ResendEmailProvider();
  } else {
    cached = new ConsoleEmailProvider();
  }
  return cached;
}
