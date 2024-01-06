module.exports = {
  apps: [
    {
      script: 'UABot.js',
      watch: ['UABot.js', 'servers.json', '.env'],
      ignore_watch: ['Events.sqlite'],
    },
  ],
};
