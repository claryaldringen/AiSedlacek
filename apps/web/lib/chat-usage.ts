/**
 * Cena chatu v panelu metadat: skutečně odečtené kredity, které server posílá
 * v SSE událostech chatu (`done`, a po přerušení i `error` s částečnou
 * spotřebou). Odhad jen tehdy, když odpověď skončila bez takové události
 * (spojení spadlo, klient přerušil) – pak skutečný odečet UI nezná.
 */

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  /** Skutečně odečtené kredity za odpověď (server); chybí u starší verze serveru. */
  chargedCredits?: number;
  /** Odpověď skončila bez události o vyúčtování – její skutečný odečet UI nezná. */
  incomplete?: boolean;
}

/** Událost SSE z `/api/documents/[id]/chat`. */
export interface ChatStreamEvent {
  type: string;
  text?: string;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number; model: string };
  chargedCredits?: number;
}

/**
 * Spotřeba odpovědi z události SSE: `done` vždy (s usage), `error` jen když
 * server stihl naúčtovat částečnou spotřebu přerušené odpovědi. Jinak null.
 */
export function chatUsageFromEvent(event: ChatStreamEvent): ChatTokenUsage | null {
  if (event.type !== 'done' && event.type !== 'error') return null;
  if (!event.usage) return null;
  if (event.type === 'error' && typeof event.chargedCredits !== 'number') return null;
  return {
    ...event.usage,
    ...(typeof event.chargedCredits === 'number' ? { chargedCredits: event.chargedCredits } : {}),
  };
}

/** Spotřeba odpovědi, která skončila bez události o vyúčtování. */
export const INCOMPLETE_CHAT_USAGE: ChatTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  model: '',
  incomplete: true,
};

export interface ChatUsageState {
  chatInputTokens?: number;
  chatOutputTokens?: number;
  chatModel?: string;
  /** Součet skutečně odečtených kreditů za chat v této relaci. */
  chatChargedCredits?: number;
  /** Některá odpověď skončila bez známého odečtu → cena chatu je neúplná. */
  chatChargeIncomplete?: boolean;
}

/** Přičte spotřebu odpovědi k souhrnu chatu dokumentu. */
export function addChatUsage<T extends ChatUsageState>(state: T, usage: ChatTokenUsage): T {
  return {
    ...state,
    chatInputTokens: (state.chatInputTokens ?? 0) + usage.inputTokens,
    chatOutputTokens: (state.chatOutputTokens ?? 0) + usage.outputTokens,
    chatModel: usage.model || state.chatModel,
    chatChargedCredits:
      usage.chargedCredits !== undefined
        ? (state.chatChargedCredits ?? 0) + usage.chargedCredits
        : state.chatChargedCredits,
    chatChargeIncomplete: Boolean(state.chatChargeIncomplete || usage.incomplete),
  };
}
