import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_PROMPT } from '@ai-sedlacek/ocr';
import { TRANSLATE_ONLY_SYSTEM_PROMPT, BATCH_OCR_INSTRUCTION } from '@ai-sedlacek/shared';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'transcribe+translate';

  const prompts: Record<string, string> = {
    'transcribe+translate': SYSTEM_PROMPT,
    translate: TRANSLATE_ONLY_SYSTEM_PROMPT,
    batch: SYSTEM_PROMPT + '\n\n' + BATCH_OCR_INSTRUCTION,
  };

  const prompt = prompts[mode];
  if (!prompt) {
    return NextResponse.json(
      { error: `Neznámý režim: ${mode}. Dostupné: ${Object.keys(prompts).join(', ')}` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    mode,
    prompt,
    availableModes: Object.keys(prompts),
  });
}
