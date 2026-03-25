import type { IEmailProvider } from '@ai-sedlacek/shared';

export class ConsoleEmailProvider implements IEmailProvider {
  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    console.log('=== PASSWORD RESET ===');
    console.log(`To: ${email}`);
    console.log(`URL: ${resetUrl}`);
    console.log('======================');
  }
}
