async function updateEmbed(message) {
  try {
    // Fetch status for both servers
    const server1Status = await getServerStatus(SERVER_ID_1);
    const server2Status = await getServerStatus(SERVER_ID_2);

    // Create embeds for each server
    const createServerEmbed = (serverStatus) => {
      const statusEmoji = serverStatus.status === 'Online' ? '🟢' : '🔴';
      
      return new EmbedBuilder()
        .setTitle(`${statusEmoji} ${serverStatus.name} Status`)
        .setColor(serverStatus.status === 'Online' ? 0x00ff00 : 0xff0000)
        .setDescription(
          `**Status:** ${serverStatus.status}\n\n` +
          `🖳 **CPU Usage:** ${serverStatus.cpu.usage}\n\n` +
          `💾 **Memory:** ${serverStatus.memory.current} / ${serverStatus.memory.limit}\n\n` +
          `💽 **Disk:** ${serverStatus.disk.current} / ${serverStatus.disk.limit}\n\n` +
          `🌐 **Network:**\n` +
          `   ⬇️ Incoming: ${serverStatus.network.incoming}\n` +
          `   ⬆️ Outgoing: ${serverStatus.network.outgoing}\n\n` +
          `⏱️ **Uptime:** ${formatUptime(parseInt(serverStatus.uptime.replace(/\D/g, '')))}`
        );
    };

    // Helper function to convert seconds to human readable time
    const formatUptime = (seconds) => {
      if (!seconds || seconds === 'N/A' || isNaN(seconds)) return 'N/A';
      
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const remainingSeconds = seconds % 60;
      
      let formattedUptime = '';
      
      if (days > 0) {
        formattedUptime += `${days} day${days !== 1 ? 's' : ''}, `;
      }
      
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedSeconds = remainingSeconds.toString().padStart(2, '0');
      
      formattedUptime += `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
      
      return formattedUptime;
    };

    // Prepare server embeds
    const server1Embed = server1Status.error 
      ? new EmbedBuilder()
          .setTitle('❌ Bitcraft Bungee Error')
          .setColor(0xff0000)
          .setDescription(server1Status.message)
      : createServerEmbed(server1Status);
    
    const server2Embed = server2Status.error 
      ? new EmbedBuilder()
          .setTitle('❌ Bitcraft Survival Error')
          .setColor(0xff0000)
          .setDescription(server2Status.message)
      : createServerEmbed(server2Status);

    // Edit the existing message with new embeds
    await message.edit({ 
      content: `🕒 Next update in: ${UPDATE_INTERVAL} seconds`,
      embeds: [server1Embed, server2Embed] 
    });

    // Implement live countdown
    let countdown = parseInt(UPDATE_INTERVAL);
    const countdownInterval = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        message.edit({ 
          content: `🕒 Next update in: ${countdown} seconds`, 
          embeds: [server1Embed, server2Embed] 
        });
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);

  } catch (error) {
    console.error('Error updating embed:', error);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  try {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
    if (!channel) {
      console.error('Could not find the specified channel');
      return;
    }
    
    const sent = await channel.send({ content: 'Starting server monitor...' });
    
    // Initial update
    await updateEmbed(sent);
    
    // Set interval for periodic updates
    setInterval(() => updateEmbed(sent), parseInt(UPDATE_INTERVAL) * 1000);
  } catch (error) {
    console.error('Error in ready event:', error);
  }
});
