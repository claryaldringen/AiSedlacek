import { Resend } from 'resend';
import type { IEmailProvider } from '@ai-sedlacek/shared';
import en from '../../../messages/en.json';
import cs from '../../../messages/cs.json';

const messages: Record<string, typeof en> = { en, cs };

function getEmailMessages(locale: string) {
  return (messages[locale] ?? messages['en']!).emails;
}

type EmailTexts = ReturnType<typeof getEmailMessages>;

export class ResendEmailProvider implements IEmailProvider {
  private client: Resend;
  private from: string;

  constructor() {
    const apiKey = process.env['RESEND_API_KEY'];
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
    this.client = new Resend(apiKey);
    this.from = process.env['EMAIL_FROM'] ?? 'Čtečka rukopisů <noreply@ai-sedlacek.cz>';
  }

  async sendPasswordReset(email: string, resetUrl: string, locale: string): Promise<void> {
    const t = getEmailMessages(locale);
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: t.passwordResetSubject,
      html: passwordResetHtml(resetUrl, t, locale),
    });
    if (error) {
      console.error('[ResendEmail] Failed to send password reset:', error);
      throw new Error(t.emailSendFailed.replace('{message}', error.message));
    }
  }

  async sendVerification(email: string, verifyUrl: string, locale: string): Promise<void> {
    const t = getEmailMessages(locale);
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: t.verificationSubject,
      html: verificationHtml(verifyUrl, t, locale),
    });
    if (error) {
      console.error('[ResendEmail] Failed to send verification:', error);
      throw new Error(t.emailSendFailed.replace('{message}', error.message));
    }
  }
}

function verificationHtml(verifyUrl: string, t: EmailTexts, lang: string): string {
  return `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 40px;">
    <h1 style="font-size: 20px; color: #1e293b; margin: 0 0 16px;">${t.verificationHeading}</h1>
    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
      ${t.verificationBody}
    </p>
    <a href="${verifyUrl}" style="display: inline-block; background: #2563eb; color: white; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
      ${t.verificationButton}
    </a>
    <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 24px 0 0;">
      ${t.verificationExpiry}
    </p>
  </div>
</body>
</html>`.trim();
}

function passwordResetHtml(resetUrl: string, t: EmailTexts, lang: string): string {
  return `
<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 40px;">
    <h1 style="font-size: 20px; color: #1e293b; margin: 0 0 16px;">${t.passwordResetHeading}</h1>
    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
      ${t.passwordResetBody}
    </p>
    <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: white; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
      ${t.passwordResetButton}
    </a>
    <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 24px 0 0;">
      ${t.passwordResetExpiry}
    </p>
  </div>
</body>
</html>`.trim();
}
