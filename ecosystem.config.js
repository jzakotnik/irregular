module.exports = {
  apps: [{
    name: 'irregular',
    script: 'server.js',
    instances: 1,            // rooms live in memory: must stay a single process
    exec_mode: 'fork',
    env: { NODE_ENV: 'production', PORT: 3000, HOST: '127.0.0.1' },
    max_memory_restart: '300M'
  }]
};
