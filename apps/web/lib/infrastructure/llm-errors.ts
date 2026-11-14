/**
 * Chyba volání Claude pro klienta: obecná lokalizovaná hláška podle typu chyby,
 * surová zpráva SDK nebo Prismy (interní detaily, request ID, SQL) jen do logu.
 * Stejný princip jako `describeJobError` ve workeru.
 */
import Anthropic from '@anthropic-ai/sdk';

type Translator = (key: string, values?: Record<string, string | number>) => string;

export function publicLlmError(err: unknown, t: Translator, logContext: string): string {
  console.error(`[${logContext}]`, err instanceof Error ? err.message : err);
  if (err instanceof Anthropic.APIError) {
    // APIConnectionError (výpadek sítě, timeout) status nemá
    return err.status
      ? t('aiServiceErrorStatus', { status: err.status })
      : t('aiServiceUnavailable');
  }
  return t('serverError');
}
