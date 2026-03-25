export interface IEmailProvider {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
  sendVerification(email: string, verifyUrl: string): Promise<void>;
}
