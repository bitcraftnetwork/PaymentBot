// index.js
// Load environment variables early
require('dotenv').config({ path: '.env' });

const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const http = require('http');

// Validate environment variables
const requiredEnvVars = [
  'DISCORD_TOKEN',
  'DISCORD_CHANNEL_ID',
  'PTERO_API_KEY',
  'PTERO_PANEL_URL',
  'SERVER_ID_1',
  'SERVER_ID_2',
  'UPDATE_INTERVAL'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  process.exit(1);
}

// Destructure environment variables with fallback defaults
const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  PTERO_API_KEY,
  PTERO_PANEL_URL,
  SERVER_ID_1,
  SERVER_ID_2,
  UPDATE_INTERVAL = '60'
} = process.env;

// Create a simple HTTP server to handle Render's health checks
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Discord Bot is running!');
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Configuration for Pterodactyl Client API
const PTERO_CLIENT_API_HEADERS = {
  'Authorization': `Bearer ${PTERO_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

async function getServerStatus(serverId) {
  try {
    // Fetch server status and resources
    const serverResponse = await axios.get(
      `${PTERO_PANEL_URL}/api/client/servers/${serverId}`, 
      { headers: PTERO_CLIENT_API_HEADERS }
    );

    const resourcesResponse = await axios.get(
      `${PTERO_PANEL_URL}/api/client/servers/${serverId}/resources`, 
      { headers: PTERO_CLIENT_API_HEADERS }
    );

    const serverDetails = serverResponse.data.attributes;
    const resources = resourcesResponse.data.attributes;

    // Correctly determine server status
    // If we can get resource data with CPU usage, it's likely online
    const isOnline = resources.resources.cpu_absolute !== null || 
                    resources.current_state === "running";

    return {
      name: serverDetails.name,
      identifier: serverDetails.identifier,
      // Server state - set based on resource availability
      status: isOnline ? 'Online' : 'Offline',
      
      // Resource details
      cpu: {
        usage: resources.resources.cpu_absolute !== null 
          ? `${resources.resources.cpu_absolute.toFixed(2)}%` 
          : 'N/A',
      },
      memory: {
        current: `${(resources.resources.memory_bytes / 1024 / 1024).toFixed(2)} MB`,
        limit: resources.resources.memory_limit_bytes ? 
          `${(resources.resources.memory_limit_bytes / 1024 / 1024).toFixed(2)} MB` : 'Unlimited',
      },
      disk: {
        current: `${(resources.resources.disk_bytes / 1024 / 1024).toFixed(2)} MB`,
        limit: resources.resources.disk_limit_bytes ? 
          `${(resources.resources.disk_limit_bytes / 1024 / 1024).toFixed(2)} MB` : 'Unlimited',
      },
      network: {
        incoming: `${(resources.resources.network_rx_bytes / 1024 / 1024).toFixed(2)} MB`,
        outgoing: `${(resources.resources.network_tx_bytes / 1024 / 1024).toFixed(2)} MB`,
      },
      uptime: resources.resources.uptime 
        ? `${Math.floor(resources.resources.uptime / 1000)} seconds` 
        : 'N/A',
    };
  } catch (error) {
    console.error('Error fetching server status:', error.response?.data || error.message);
    return {
      error: true,
      message: error.response?.data?.errors?.[0]?.detail || error.message,
    };
  }
}

async function updateEmbed(message) {
  try {
    // Fetch status for both servers
    const server1Status = await getServerStatus(SERVER_ID_1);
    const server2Status = await getServerStatus(SERVER_ID_2);

    const embed = new EmbedBuilder()
      .setTitle('🖥️ Server Status')
      .setColor(0x00ff00)
      .setTimestamp(new Date())
      .setFooter({ text: `Updates every ${UPDATE_INTERVAL}s` });

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

    // Process each server's status
    [server1Status, server2Status].forEach((serverStatus, index) => {
      if (serverStatus.error) {
        // Handle error case
        embed.addFields({
          name: `Server ${index + 1}`,
          value: `❌ Error: ${serverStatus.message}`,
        });
      } else {
        // Status emoji
        const statusEmoji = serverStatus.status === 'Online' ? '🟢' : '🔴';
        
        // Create detailed status field with better formatting
        embed.addFields({
          name: `${statusEmoji} ${serverStatus.name} (${serverStatus.status})`,
          value: 
            `🖳 CPU: ${serverStatus.cpu.usage}\n` +
            `💾 Memory: ${serverStatus.memory.current} / ${serverStatus.memory.limit}\n` +
            `💽 Disk: ${serverStatus.disk.current} / ${serverStatus.disk.limit}\n` +
            `🌐 Network: ⬇️ ${serverStatus.network.incoming} | ⬆️ ${serverStatus.network.outgoing}\n` + 
            `⏱️ Uptime: ${formatUptime(parseInt(serverStatus.uptime.replace(/\D/g, '')))}`,
          inline: false
        });
      }
    });

    // Edit the existing message with new embed
    await message.edit({ embeds: [embed] });
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
    setInterval(() => updateEmbed(sent), parseInt(UPDATE_INTERVAL) * 1000);
  } catch (error) {
    console.error('Error in ready event:', error);
  }
});

client.on('error', (error) => {
  console.error('Discord client error:', error);
});

client.login(DISCORD_TOKEN).catch(error => {
  console.error('Login error:', error);
});
