import type { IEmailProvider } from '@ai-sedlacek/shared';

export class ConsoleEmailProvider implements IEmailProvider {
  async sendPasswordReset(email: string, resetUrl: string, locale: string): Promise<void> {
    console.log('=== PASSWORD RESET ===');
    console.log(`To: ${email}`);
    console.log(`URL: ${resetUrl}`);
    console.log(`Locale: ${locale}`);
    console.log('======================');
  }

  async sendVerification(email: string, verifyUrl: string, locale: string): Promise<void> {
    console.log('=== EMAIL VERIFICATION ===');
    console.log(`To: ${email}`);
    console.log(`URL: ${verifyUrl}`);
    console.log(`Locale: ${locale}`);
    console.log('==========================');
  }
}
