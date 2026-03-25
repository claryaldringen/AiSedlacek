export interface IEmailProvider {
  sendPasswordReset(email: string, resetUrl: string, locale: string): Promise<void>;
  sendVerification(email: string, verifyUrl: string, locale: string): Promise<void>;
}
