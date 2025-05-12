async function updateEmbed(message, refreshInterval) {
  let countdownSeconds = refreshInterval;
  
  try {
    // Fetch status for both servers
    const server1Status = await getServerStatus(SERVER_ID_1);
    const server2Status = await getServerStatus(SERVER_ID_2);

    // Create individual embeds for each server
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
      
      // Format with leading zeros and proper labels
      let formattedUptime = '';
      
      if (days > 0) {
        formattedUptime += `${days} day${days !== 1 ? 's' : ''}, `;
      }
      
      // Always show hours, minutes, seconds in HH:MM:SS format
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedSeconds = remainingSeconds.toString().padStart(2, '0');
      
      formattedUptime += `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
      
      return formattedUptime;
    };

    // Main status embed with countdown
    const mainStatusEmbed = new EmbedBuilder()
      .setTitle('🖥️ Server Monitoring')
      .setColor(0x3498db)
      .setDescription('Real-time server status and resource monitoring')
      .setTimestamp(new Date());

    // Embed for error cases
    const createErrorEmbed = (errorMessage) => {
      return new EmbedBuilder()
        .setTitle('❌ Server Status Error')
        .setColor(0xff0000)
        .setDescription(errorMessage);
    };

    // Prepare embeds based on server status
    const server1Embed = server1Status.error 
      ? createErrorEmbed(server1Status.message) 
      : createServerEmbed(server1Status);
    
    const server2Embed = server2Status.error 
      ? createErrorEmbed(server2Status.message) 
      : createServerEmbed(server2Status);

    // Edit the existing message with new embeds
    await message.edit({ 
      content: `🕒 Next update in: ${countdownSeconds} seconds`, 
      embeds: [server1Embed, server2Embed] 
    });

    // Create a countdown mechanism
    const countdownInterval = setInterval(() => {
      countdownSeconds--;
      if (countdownSeconds > 0) {
        message.edit({ 
          content: `🕒 Next update in: ${countdownSeconds} seconds`, 
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
    
    const refreshInterval = parseInt(UPDATE_INTERVAL);
    const sent = await channel.send({ content: 'Starting server monitor...' });
    
    // Initial update
    await updateEmbed(sent, refreshInterval);
    
    // Set interval for periodic updates
    setInterval(() => updateEmbed(sent, refreshInterval), refreshInterval * 1000);
  } catch (error) {
    console.error('Error in ready event:', error);
  }
});
