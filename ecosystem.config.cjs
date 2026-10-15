module.exports = {
  apps: [
    {
      name: 'ai-sedlacek-web',
      cwd: '/opt/AiSedlacek',
      script: 'apps/web/.next/standalone/apps/web/server.js',
      env: {
        PORT: 3003,
        HOSTNAME: '0.0.0.0',
      },
      node_args: '--env-file=/opt/AiSedlacek/.env',
      max_memory_restart: '500M',
    },
    // TODO(CR): v produkci spouštět zkompilovaný JS místo tsx (devDependency)
    {
      name: 'ai-sedlacek-worker',
      cwd: '/opt/AiSedlacek',
      script: 'apps/worker/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm --env-file=/opt/AiSedlacek/.env',
      // NODE_ENV nastavujeme tady – .env ho neobsahuje a worker podle něj odmítne
      // start s LLM_PROVIDER=claude-cli (SEC-12). Jediný další vliv: Prisma vrací
      // stručnější chybové hlášky (errorFormat "minimal", bez výpisu zdrojáku).
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '500M',
    },
  ],
};
