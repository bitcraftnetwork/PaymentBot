client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) return console.error('Could not find the specified channel');

    // Send countdown message
    const countdownMessage = await channel.send('🕒 Refreshing in 10s');

    // Send placeholder messages for each server (will be updated)
    const serverMessage1 = await channel.send({ content: 'Fetching Bitcraft Bungee status...' });
    const serverMessage2 = await channel.send({ content: 'Fetching Bitcraft Survival status...' });

    let countdown = parseInt(UPDATE_INTERVAL);

    setInterval(async () => {
      countdown = parseInt(UPDATE_INTERVAL);
      
      // Countdown every second
      const countdownInterval = setInterval(async () => {
        if (countdown > 0) {
          await countdownMessage.edit(`🕒 Refreshing in ${countdown}s`);
          countdown--;
        } else {
          clearInterval(countdownInterval);

          // Refresh server statuses
          const server1 = await getServerStatus(SERVER_ID_1);
          const server2 = await getServerStatus(SERVER_ID_2);

          const formatUptime = (seconds) => {
            if (!seconds || seconds === 'N/A' || isNaN(seconds)) return 'N/A';
            const d = Math.floor(seconds / 86400);
            const h = Math.floor((seconds % 86400) / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            let result = '';
            if (d) result += `${d} day${d > 1 ? 's' : ''}, `;
            return result + `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
          };

          // Embed for Server 1
          const embed1 = new EmbedBuilder()
            .setTitle(`🖥️ ${server1.name} (${server1.status})`)
            .setColor(server1.status === 'Online' ? 0x00ff00 : 0xff0000)
            .addFields([
              { name: '🖳 CPU', value: server1.cpu.usage, inline: true },
              { name: '💾 Memory', value: `${server1.memory.current} / ${server1.memory.limit}`, inline: true },
              { name: '💽 Disk', value: `${server1.disk.current} / ${server1.disk.limit}`, inline: true },
              { name: '🌐 Network', value: `⬇️ ${server1.network.incoming} | ⬆️ ${server1.network.outgoing}`, inline: true },
              { name: '⏱️ Uptime', value: formatUptime(parseInt(server1.uptime.replace(/\D/g, ''))), inline: false }
            ])
            .setTimestamp();

          // Embed for Server 2
          const embed2 = new EmbedBuilder()
            .setTitle(`🖥️ ${server2.name} (${server2.status})`)
            .setColor(server2.status === 'Online' ? 0x00ff00 : 0xff0000)
            .addFields([
              { name: '🖳 CPU', value: server2.cpu.usage, inline: true },
              { name: '💾 Memory', value: `${server2.memory.current} / ${server2.memory.limit}`, inline: true },
              { name: '💽 Disk', value: `${server2.disk.current} / ${server2.disk.limit}`, inline: true },
              { name: '🌐 Network', value: `⬇️ ${server2.network.incoming} | ⬆️ ${server2.network.outgoing}`, inline: true },
              { name: '⏱️ Uptime', value: formatUptime(parseInt(server2.uptime.replace(/\D/g, ''))), inline: false }
            ])
            .setTimestamp();

          // Update messages
          await serverMessage1.edit({ embeds: [embed1] });
          await serverMessage2.edit({ embeds: [embed2] });

          await countdownMessage.edit(`🕒 Refreshing in ${UPDATE_INTERVAL}s`);
        }
      }, 1000);

    }, parseInt(UPDATE_INTERVAL) * 1000);

  } catch (error) {
    console.error('Error in ready event:', error);
  }
});
