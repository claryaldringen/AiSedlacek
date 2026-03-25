import { Resend } from 'resend';
import type { IEmailProvider } from '@ai-sedlacek/shared';

export class ResendEmailProvider implements IEmailProvider {
  private client: Resend;
  private from: string;

  constructor() {
    const apiKey = process.env['RESEND_API_KEY'];
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
    this.client = new Resend(apiKey);
    this.from = process.env['EMAIL_FROM'] ?? 'Čtečka rukopisů <noreply@ai-sedlacek.cz>';
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: 'Obnovení hesla',
      html: passwordResetHtml(resetUrl),
    });
    if (error) {
      console.error('[ResendEmail] Failed to send password reset:', error);
      throw new Error(`Email se nepodařilo odeslat: ${error.message}`);
    }
  }

  async sendVerification(email: string, verifyUrl: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: 'Ověření emailové adresy',
      html: verificationHtml(verifyUrl),
    });
    if (error) {
      console.error('[ResendEmail] Failed to send verification:', error);
      throw new Error(`Email se nepodařilo odeslat: ${error.message}`);
    }
  }
}

function verificationHtml(verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="cs">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 40px;">
    <h1 style="font-size: 20px; color: #1e293b; margin: 0 0 16px;">Ověření emailu</h1>
    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
      Pro dokončení registrace ověřte svou emailovou adresu kliknutím na tlačítko níže.
    </p>
    <a href="${verifyUrl}" style="display: inline-block; background: #2563eb; color: white; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
      Ověřit email
    </a>
    <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 24px 0 0;">
      Odkaz je platný 24 hodin.
    </p>
  </div>
</body>
</html>`.trim();
}

function passwordResetHtml(resetUrl: string): string {
  return `
<!DOCTYPE html>
<html lang="cs">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 40px 20px;">
  <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 40px;">
    <h1 style="font-size: 20px; color: #1e293b; margin: 0 0 16px;">Obnovení hesla</h1>
    <p style="font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 24px;">
      Obdrželi jsme žádost o obnovení hesla k vašemu účtu. Klikněte na tlačítko níže pro nastavení nového hesla.
    </p>
    <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: white; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
      Nastavit nové heslo
    </a>
    <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 24px 0 0;">
      Odkaz je platný 1 hodinu. Pokud jste o obnovení hesla nežádali, tento email ignorujte.
    </p>
  </div>
</body>
</html>`.trim();
}
