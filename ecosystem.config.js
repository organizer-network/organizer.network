module.exports = {
  apps : [{
    name: 'organizer.network',
    script: './bin/start.js',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }],
};
