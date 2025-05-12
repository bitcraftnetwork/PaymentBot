client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
  const updateInterval = 10; // seconds

  let countdown = updateInterval;
  const countdownMessage = await channel.send(`🕒 Refreshing in ${countdown}s`);

  setInterval(async () => {
    countdown = updateInterval;

    const inner = setInterval(async () => {
      countdown--;
      if (countdown > 0) {
        await countdownMessage.edit(`🕒 Refreshing in ${countdown}s`);
      } else {
        clearInterval(inner);
        await countdownMessage.edit(`🕒 Refreshing in ${updateInterval}s`);

        // This is where you'd update your actual server embed
        console.log('Update server embed now');
      }
    }, 1000);

  }, updateInterval * 1000);
});
