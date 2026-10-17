/**
 * Sonora — Configuração PM2 para Execução 24/7 (Windows / Linux VPS)
 * Uso:
 *   npm run build
 *   npx pm2 start ecosystem.config.cjs
 *   npx pm2 save
 */
module.exports = {
  apps: [
    {
      name: 'sonora-bot-server',
      script: './apps/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    }
  ]
};
