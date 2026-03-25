export interface IEmailProvider {
  sendPasswordReset(email: string, resetUrl: string): Promise<void>;
}
