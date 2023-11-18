module.exports = {
  apps : [{
    script: 'UABot.ts',
    interpreter: 'ts-node',
    watch: '.',
    ignore_watch:["Events.sqlite"],
  }],
};
