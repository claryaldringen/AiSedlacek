import { serve } from 'inngest/next';
import { inngest } from '@/lib/infrastructure/inngest';
import { processPages } from '@/inngest/process-pages';

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processPages],
});
