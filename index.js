// Discord Rank Purchase Bot for Render.com
require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder,
  StringSelectMenuBuilder, EmbedBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const axios = require('axios');
const QRCode = require('qrcode');
const { createServer } = require('http');

// Keep-alive server for Render
const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot is running!');
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const CHANNEL_ID = process.env.CHANNEL_ID;
const NOCODB_API_URL = process.env.NOCODB_API_URL;
const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN;
const TABLE_ID = process.env.TABLE_ID;
const UPI_ID = process.env.UPI_ID;
const UPI_NAME = process.env.UPI_NAME;

const RANKS = {
  seasonal: [
    { name: 'ather', price: 99 },
    { name: 'void', price: 199 },
    { name: 'nexor', price: 349 },
    { name: 'ascendant', price: 599 },
    { name: 'runetide', price: 799 }
  ],
  lifetime: [
    { name: 'nexus', price: 149 },
    { name: 'hexCrafter', price: 299 },
    { name: 'etherKnight', price: 499 },
    { name: 'voidBound', price: 999 }
  ]
};

const paymentSessions = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.channel.id !== CHANNEL_ID) return;
  if (message.content === '!setup-rank-purchase' && message.member.permissions.has('ADMINISTRATOR')) {
    await setupRankPurchase(message.channel);
  }
});

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

  await channel.send({ embeds: [embed], components: [row] });
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.channelId !== CHANNEL_ID) return;

    if (interaction.isButton()) {
      if (interaction.customId === 'buy_rank') {
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
      } else if (interaction.customId === 'verify_payment') {
        await verifyPayment(interaction);
      } else if (interaction.customId === 'cancel_payment') {
        const userId = interaction.user.id;
        if (paymentSessions.has(userId)) {
          const session = paymentSessions.get(userId);
          clearTimeout(session.timeout);
          clearInterval(session.interval);

          paymentSessions.delete(userId);
          try {
            await interaction.message.delete();
          } catch (err) {
            console.error('Error deleting message on cancel:', err);
          }

          await interaction.reply({ content: 'Payment cancelled.', ephemeral: true });
        } else {
          await interaction.reply({ content: 'No active payment session found.', ephemeral: true });
        }
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'username_modal') {
        const username = interaction.fields.getTextInputValue('minecraft_username');
        await showRankTypeSelection(interaction, username);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'rank_type_select') {
        const username = interaction.values[0].split('_')[1];
        const rankType = interaction.values[0].split('_')[0];
        await showRankSelection(interaction, username, rankType);
      } else if (interaction.customId === 'rank_select') {
        const [username, rankType, rankIndex] = interaction.values[0].split('_');
        const selectedRank = RANKS[rankType][parseInt(rankIndex)];
        await initiatePayment(interaction, username, selectedRank);
      }
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    try {
      const content = 'An error occurred. Please try again.';
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

async function showRankTypeSelection(interaction, username) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('rank_type_select')
    .setPlaceholder('Select Rank Type')
    .addOptions([
      { label: 'Seasonal Ranks', description: 'Temporary ranks', value: `seasonal_${username}` },
      { label: 'Lifetime Ranks', description: 'Permanent ranks', value: `lifetime_${username}` }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: `Select rank type for **${username}**:`,
    components: [row],
    ephemeral: true
  });
}

async function showRankSelection(interaction, username, rankType) {
  const options = RANKS[rankType].map((rank, index) => ({
    label: rank.name,
    description: `₹${rank.price}`,
    value: `${username}_${rankType}_${index}`
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('rank_select')
    .setPlaceholder(`Select ${rankType} Rank`)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.update({
    content: `Select a ${rankType} rank for **${username}**:`,
    components: [row]
  });
}

async function initiatePayment(interaction, username, selectedRank) {
  try {
    const paymentId = await createNocoDBEntry(username, selectedRank.name, selectedRank.price, 'pending');
    if (!paymentId) {
      await interaction.update({
        content: 'Error creating payment record. Please try again later.',
        components: []
      });
      return;
    }

    const qrCodeBuffer = await generatePaymentQR(selectedRank.price);
    const expiration = Date.now() + 2 * 60 * 1000;
    const getRemainingTime = () => Math.max(0, Math.floor((expiration - Date.now()) / 1000));

    const embed = new EmbedBuilder()
      .setTitle('Payment Required')
      .setDescription(`Scan the QR to pay ₹${selectedRank.price} for ${selectedRank.name} rank`)
      .setImage('attachment://payment_qr.png')
      .setColor('#ffd700')
      .setFooter({ text: 'Payment expires in 2 minutes' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('verify_payment').setLabel('I have paid').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel_payment').setLabel('Cancel').setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.update({
      content: `Processing payment for **${username}** - ${selectedRank.name} (₹${selectedRank.price})\n⏳ Time remaining: 120s`,
      embeds: [embed],
      files: [{ attachment: qrCodeBuffer, name: 'payment_qr.png' }],
      components: [row],
      fetchReply: true
    });

    const userId = interaction.user.id;

    const countdownInterval = setInterval(async () => {
      const remaining = getRemainingTime();
      if (remaining <= 0) return;

      try {
        await message.edit({
          content: `Processing payment for **${username}** - ${selectedRank.name} (₹${selectedRank.price})\n⏳ Time remaining: ${remaining}s`
        });
      } catch (err) {
        console.error('Failed to update countdown:', err);
      }
    }, 10000);

    const timeout = setTimeout(async () => {
      clearInterval(countdownInterval);
      await updateNocoDBEntry(paymentId, 'expired');
      try {
        await message.delete();
      } catch (err) {
        console.error('Failed to delete expired message:', err);
      }
      paymentSessions.delete(userId);
    }, 2 * 60 * 1000);

    paymentSessions.set(userId, {
      username,
      rank: selectedRank.name,
      price: selectedRank.price,
      paymentId,
      timeout,
      interval: countdownInterval,
      messageId: message.id
    });
  } catch (error) {
    console.error('Error initiating payment:', error);
    await interaction.update({
      content: 'An error occurred while initiating payment.',
      components: []
    });
  }
}

async function verifyPayment(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  if (!paymentSessions.has(userId)) {
    await interaction.followUp({ content: 'No active payment session found.', ephemeral: true });
    return;
  }

  const session = paymentSessions.get(userId);
  try {
    const paymentStatus = await checkPaymentStatus(session.paymentId);

    if (paymentStatus === 'done') {
      clearTimeout(session.timeout);
      paymentSessions.delete(userId);

      // Debugging: Log message and channel information
      console.log(`Attempting to edit message with ID: ${session.messageId}`);
      console.log(`Message Channel ID: ${interaction.channelId}`);
      
      // Check if the message exists and is in the correct channel
      try {
        const targetMessage = await interaction.channel.messages.fetch(session.messageId);
        await targetMessage.edit({
          content: `✅ Payment completed for **${session.username}**!\nYou now have the ${session.rank} rank.`,
          embeds: [],
          components: []
        });
      } catch (err) {
        if (err.code === 10008) {
          console.log('Message no longer exists in the channel.');
        } else {
          throw err;
        }
      }

      await interaction.followUp({ content: '✅ Your rank has been activated!', ephemeral: true });
    } else {
      await interaction.followUp({
        content: 'Payment not verified yet. Please try again in a few seconds.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    await interaction.followUp({
      content: 'An error occurred while verifying your payment.',
      ephemeral: true
    });
  }
}

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
    return response.data.Id;
  } catch (error) {
    console.error('Error creating NocoDB entry:', error.response?.data || error.message);
    return null;
  }
}

async function updateNocoDBEntry(id, status) {
  try {
    await axios.patch(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records/${id}`,
      { status },
      {
        headers: {
          'xc-token': NOCODB_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    return true;
  } catch (error) {
    console.error('Error updating NocoDB entry:', error.response?.data || error.message);
    return false;
  }
}

async function checkPaymentStatus(id) {
  try {
    const response = await axios.get(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records/${id}`,
      {
        headers: { 'xc-token': NOCODB_API_TOKEN }
      }
    );
    return response.data.status;
  } catch (error) {
    console.error('Error checking payment status:', error.response?.data || error.message);
    return 'error';
  }
}

async function generatePaymentQR(amount) {
  try {
    const paymentLink = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&mc=0000&tid=${Date.now()}&amount=${amount}&currency=INR&name=Rank%20Purchase`;
    return await QRCode.toBuffer(paymentLink, { errorCorrectionLevel: 'H' });
  } catch (error) {
    console.error('Error generating QR code:', error);
    return null;
  }
}

client.login(process.env.DISCORD_TOKEN);
