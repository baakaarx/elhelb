module.exports = {
  apps: [
    {
      name: 'elhelb-boards',
      cwd: __dirname,
      script: 'server/index.js',
      node_args: '--no-warnings',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: process.env.PORT || 3000,
        DB_PATH: process.env.DB_PATH || '/opt/elhelb-data/elhelb-boards.db',
      },
    },
  ],
};
