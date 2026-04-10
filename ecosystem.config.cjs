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
    {
      name: 'ai-sedlacek-worker',
      cwd: '/opt/AiSedlacek',
      script: 'apps/worker/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm --env-file=/opt/AiSedlacek/.env',
      max_memory_restart: '500M',
    },
  ],
};
