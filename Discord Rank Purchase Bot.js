// Discord Rank Purchase Bot for Render.com
// This bot allows users to purchase Minecraft ranks and handles the payment process

require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
        StringSelectMenuBuilder, EmbedBuilder, ButtonStyle, 
        ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const QRCode = require('qrcode');
const { createServer } = require('http');

// Create a simple HTTP server to keep the bot alive on Render.com free tier
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Initialize Discord client
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

// Global variables
const CHANNEL_ID = process.env.CHANNEL_ID; // Channel where bot should respond
const NOCODB_API_URL = process.env.NOCODB_API_URL;
const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN;
const TABLE_ID = process.env.TABLE_ID; // Table ID from NocoDB
const VIEW_ID = process.env.VIEW_ID; // View ID from NocoDB

// UPI payment details
const UPI_ID = process.env.UPI_ID || "8320220667-2@axl";
const UPI_NAME = process.env.UPI_NAME || "******0667";

// Rank definitions
const RANKS = {
  seasonal: [
    { name: 'Ather', price: 99 },
    { name: 'Void', price: 199 },
    { name: 'Nexor', price: 349 },
    { name: 'Ascendant', price: 599 },
    { name: 'Runetide', price: 799 }
  ],
  lifetime: [
    { name: 'Nexus', price: 149 },
    { name: 'HexCrafter', price: 299 },
    { name: 'EtherKnight', price: 499 },
    { name: 'VoidBound', price: 999 }
  ]
};

// Active payment sessions
const paymentSessions = new Map();

// Bot is ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// Message events handler
client.on('messageCreate', async (message) => {
  // Only respond in the designated channel
  if (message.channel.id !== CHANNEL_ID) return;
  
  // Check for admin commands
  if (message.content === '!setup-rank-purchase' && message.member.permissions.has('ADMINISTRATOR')) {
    await setupRankPurchase(message.channel);
  }
});

// Creates the initial buy button message
async function setupRankPurchase(channel) {
  const embed = new EmbedBuilder()
    .setTitle('Minecraft Rank Purchase')
    .setDescription('Click the button below to purchase a rank for Minecraft!')
    .setColor('#00ff00');

  const button = new ButtonBuilder()
    .setCustomId('buy_rank')
    .setLabel('Buy Rank')
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

// Handle button interactions
client.on('interactionCreate', async (interaction) => {
  try {
    // Only process interactions in the designated channel
    if (interaction.channelId !== CHANNEL_ID) return;
    
    // Handle button clicks
    if (interaction.isButton()) {
      if (interaction.customId === 'buy_rank') {
        // Display username modal
        const modal = new ModalBuilder()
          .setCustomId('username_modal')
          .setTitle('Enter Minecraft Username');
          
        const usernameInput = new TextInputBuilder()
          .setCustomId('minecraft_username')
          .setLabel('Your Minecraft Username')
          .setPlaceholder('Enter your Minecraft username')
          .setRequired(true)
          .setStyle(TextInputStyle.Short);
          
        const firstRow = new ActionRowBuilder().addComponents(usernameInput);
        modal.addComponents(firstRow);
        
        await interaction.showModal(modal);
      }
      // Handle payment verification button
      else if (interaction.customId === 'verify_payment') {
        await verifyPayment(interaction);
      }
      // Handle payment cancellation
      else if (interaction.customId === 'cancel_payment') {
        const userId = interaction.user.id;
        if (paymentSessions.has(userId)) {
          clearTimeout(paymentSessions.get(userId).timeout);
          paymentSessions.delete(userId);
          await interaction.reply({ content: 'Payment cancelled.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'No active payment session found.', ephemeral: true });
        }
      }
    }
    
    // Handle modal submissions
    else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'username_modal') {
        const username = interaction.fields.getTextInputValue('minecraft_username');
        await showRankTypeSelection(interaction, username);
      }
    }
    
    // Handle dropdown selection
    else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'rank_type_select') {
        const username = interaction.values[0].split('_')[1]; // Format: type_username
        const rankType = interaction.values[0].split('_')[0]; // seasonal or lifetime
        await showRankSelection(interaction, username, rankType);
      }
      else if (interaction.customId === 'rank_select') {
        const [username, rankType, rankIndex] = interaction.values[0].split('_');
        const selectedRank = RANKS[rankType][parseInt(rankIndex)];
        await initiatePayment(interaction, username, selectedRank);
      }
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    // Try to respond to the user with an error message
    try {
      const content = 'An error occurred while processing your request. Please try again later.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    } catch (replyError) {
      console.error('Error sending error message:', replyError);
    }
  }
});

// Show rank type selection dropdown (Seasonal vs Lifetime)
async function showRankTypeSelection(interaction, username) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('rank_type_select')
    .setPlaceholder('Select Rank Type')
    .addOptions([
      {
        label: 'Seasonal Ranks',
        description: 'Temporary ranks that need renewal',
        value: `seasonal_${username}`
      },
      {
        label: 'Lifetime Ranks',
        description: 'Permanent ranks that never expire',
        value: `lifetime_${username}`
      }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: `Select rank type for **${username}**:`,
    components: [row],
    ephemeral: true
  });
}

// Show specific rank selection dropdown based on type
async function showRankSelection(interaction, username, rankType) {
  const options = RANKS[rankType].map((rank, index) => ({
    label: rank.name,
    description: `₹${rank.price}`,
    value: `${username}_${rankType}_${index}`
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('rank_select')
    .setPlaceholder(`Select ${rankType.charAt(0).toUpperCase() + rankType.slice(1)} Rank`)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.update({
    content: `Select a ${rankType} rank for **${username}**:`,
    components: [row]
  });
}

// Initiate payment process for selected rank
async function initiatePayment(interaction, username, selectedRank) {
  try {
    // Save to NocoDB with 'pending' status
    const paymentId = await createNocoDBEntry(username, selectedRank.name, selectedRank.price, 'pending');
    
    if (!paymentId) {
      await interaction.update({
        content: 'Error creating payment record. Please try again later.',
        components: []
      });
      return;
    }

    // Generate QR code (replace with actual payment QR code generation)
    const qrCodeUrl = await generatePaymentQR(selectedRank.price);
    
    // Create payment embed
    const embed = new EmbedBuilder()
      .setTitle('Payment Required')
      .setDescription(`Please scan the QR code to pay ₹${selectedRank.price} for ${selectedRank.name} rank`)
      .setImage(qrCodeUrl)
      .setColor('#ffd700')
      .setFooter({ text: 'Payment expires in 2 minutes' });

    // Verification button
    const verifyButton = new ButtonBuilder()
      .setCustomId('verify_payment')
      .setLabel('I have paid')
      .setStyle(ButtonStyle.Success);
      
    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_payment')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(verifyButton, cancelButton);

    await interaction.update({
      content: `Processing payment for **${username}** - ${selectedRank.name} (₹${selectedRank.price})`,
      embeds: [embed],
      components: [row]
    });

    // Store payment information and set timer
    const userId = interaction.user.id;
    const timeout = setTimeout(async () => {
      // Payment expired
      try {
        // Update status to expired in NocoDB
        await updateNocoDBEntry(paymentId, 'expired');
        
        // Check if message can still be edited
        await interaction.editReply({
          content: `Payment for **${username}** has expired.`,
          embeds: [],
          components: []
        });
        
        paymentSessions.delete(userId);
      } catch (error) {
        console.error('Error handling payment expiration:', error);
      }
    }, 2 * 60 * 1000); // 2 minutes
    
    // Store session data
    paymentSessions.set(userId, {
      username,
      rank: selectedRank.name,
      price: selectedRank.price,
      paymentId,
      timeout,
      messageId: interaction.message.id
    });
  } catch (error) {
    console.error('Error initiating payment:', error);
    await interaction.update({
      content: 'An error occurred while initiating payment. Please try again later.',
      components: []
    });
  }
}

// Verify payment and update status
async function verifyPayment(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const userId = interaction.user.id;
  if (!paymentSessions.has(userId)) {
    await interaction.followUp({ content: 'No active payment session found.', ephemeral: true });
    return;
  }
  
  const session = paymentSessions.get(userId);
  
  try {
    // Check payment status in NocoDB (in real implementation, check actual payment gateway)
    const paymentStatus = await checkPaymentStatus(session.paymentId);
    
    if (paymentStatus === 'done') {
      // Payment already verified
      clearTimeout(session.timeout);
      paymentSessions.delete(userId);
      
      // Update original message
      await interaction.message.edit({
        content: `✅ Payment completed for **${session.username}**!\nYou now have the ${session.rank} rank.`,
        embeds: [],
        components: []
      });
      
      await interaction.followUp({ content: '✅ Your rank has been activated!', ephemeral: true });
    } else {
      // Manual verification process (in real implementation, check with payment gateway)
      // For demo purposes, we'll simulate checking and updating the status
      const isVerified = await simulatePaymentVerification(session.paymentId);
      
      if (isVerified) {
        // Cancel the timeout
        clearTimeout(session.timeout);
        paymentSessions.delete(userId);
        
        // Update original message
        await interaction.message.edit({
          content: `✅ Payment completed for **${session.username}**!\nYou now have the ${session.rank} rank.`,
          embeds: [],
          components: []
        });
        
        await interaction.followUp({ content: '✅ Payment verified! Your rank has been activated.', ephemeral: true });
      } else {
        await interaction.followUp({ 
          content: 'Payment not verified yet. If you have completed the payment, please wait a moment and try again.',
          ephemeral: true 
        });
      }
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    await interaction.followUp({ 
      content: 'An error occurred while verifying your payment. Please try again later.',
      ephemeral: true 
    });
  }
}

// Create entry in NocoDB
async function createNocoDBEntry(username, rankName, amount, status) {
  try {
    const response = await axios.post(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records`,
      {
        minecraft_username: username,
        rank_name: rankName,
        amount: amount,
        status: status
      },
      {
        headers: {
          'xc-token': NOCODB_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.id;
  } catch (error) {
    console.error('Error creating NocoDB entry:', error);
    console.error(error.response?.data || error.message);
    return null;
  }
}

// Update entry in NocoDB
async function updateNocoDBEntry(id, status) {
  try {
    await axios.patch(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records/${id}`,
      {
        status: status
      },
      {
        headers: {
          'xc-token': NOCODB_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return true;
  } catch (error) {
    console.error('Error updating NocoDB entry:', error);
    console.error(error.response?.data || error.message);
    return false;
  }
}

// Check payment status in NocoDB
async function checkPaymentStatus(id) {
  try {
    const response = await axios.get(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records/${id}`,
      {
        headers: {
          'xc-token': NOCODB_API_TOKEN
        }
      }
    );
    
    return response.data.status;
  } catch (error) {
    console.error('Error checking payment status:', error);
    console.error(error.response?.data || error.message);
    return 'error';
  }
}

// Generate UPI payment QR code
async function generatePaymentQR(amount) {
  try {
    // Create UPI payment string with amount
    const upiString = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${amount}&mc=0000&mode=02&purpose=00`;
    
    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(upiString, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    return qrCodeDataUrl;
  } catch (error) {
    console.error('Error generating QR code:', error);
    // Return fallback QR code if generation fails
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&am=${amount}&mc=0000&mode=02&purpose=00`;
  }
}

// Check payment status in NocoDB for verification
async function simulatePaymentVerification(paymentId) {
  try {
    // Check current status directly from NocoDB
    const status = await checkPaymentStatus(paymentId);
    
    // If status has been updated to 'done', payment is verified
    if (status === 'done') {
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking payment verification:', error);
    return false;
  }
}

// Login to Discord
client.login(process.env.DISCORD_TOKEN);