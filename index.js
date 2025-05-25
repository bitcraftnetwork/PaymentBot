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
const DISCOUNT_TABLE_ID = process.env.Discount_TABLE_ID;
const DISCOUNT_VIEW_ID = process.env.Discount_VIEW_ID;
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
  ],
  claimblocks: [
    { name: '15k Claimblocks', price: 50, numeric_value: 15000 },
    { name: '30k Claimblocks', price: 110, numeric_value: 30000 },
    { name: '50k Claimblocks', price: 190, numeric_value: 50000 },
    { name: '75k Claimblocks', price: 240, numeric_value: 75000 },
    { name: '100k Claimblocks', price: 300, numeric_value: 100000 },
    { name: '150k Claimblocks', price: 425, numeric_value: 150000 }
  ],
  coins: [
    { name: '100 Coins', price: 25, numeric_value: 100 },
    { name: '250 Coins', price: 60, numeric_value: 250 },
    { name: '500 Coins', price: 120, numeric_value: 500 },
    { name: '1000 Coins', price: 200, numeric_value: 1000 },
    { name: '2.5k Coins', price: 450, numeric_value: 2500 },
    { name: '5k Coins', price: 800, numeric_value: 5000 }
  ],
  cratekeys: [
    { name: 'Coming Soon', price: 0 }
  ]
};

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Helper function to get display name for categories
function getCategoryDisplayName(category) {
  const categoryNames = {
    seasonal: 'Seasonal Rank',
    lifetime: 'Lifetime Rank',
    claimblocks: 'Claimblocks',
    coins: 'Coins',
    cratekeys: 'Crate Keys'
  };
  return categoryNames[category] || category;
}

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
    .setTitle('Minecraft Item Purchase')
    .setDescription('Click the button below to purchase a rank, claimblocks, coins, or crate keys for Minecraft!')
    .setColor('#00ff00');

  const button = new ButtonBuilder()
    .setCustomId('buy_rank')
    .setLabel('Buy Item')
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
          
          await updateNocoDBEntry(session.paymentId, 'cancelled');

          try {
            await interaction.update({
              content: `Payment cancelled for **${session.username}** - ${session.rank} (₹${session.finalPrice || session.price})`,
              embeds: [],
              components: [],
              files: []
            });
          } catch (err) {
            console.error('Error updating message on cancel:', err);
          }

          paymentSessions.delete(userId);
        } else {
          await interaction.reply({ content: 'No active payment session found.', ephemeral: true });
        }
      } else if (interaction.customId.startsWith('back_to_categories_')) {
        const username = interaction.customId.replace('back_to_categories_', '');
        await showCategorySelection(interaction, username, true);
      } else if (interaction.customId === 'apply_discount') {
        await showDiscountModal(interaction);
      } else if (interaction.customId === 'skip_discount') {
        await proceedWithoutDiscount(interaction);
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'username_modal') {
        const username = interaction.fields.getTextInputValue('minecraft_username');
        await showCategorySelection(interaction, username);
      } else if (interaction.customId === 'discount_modal') {
        await handleDiscountCode(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'category_select') {
        const username = interaction.values[0].split('_')[1];
        const category = interaction.values[0].split('_')[0];
        await showItemSelection(interaction, username, category);
      } else if (interaction.customId === 'item_select') {
        const [username, category, itemIndex] = interaction.values[0].split('_');
        const selectedItem = RANKS[category][parseInt(itemIndex)];
        await showDiscountOption(interaction, username, selectedItem, category);
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

async function showCategorySelection(interaction, username, isUpdate = false) {
  const embed = new EmbedBuilder()
    .setTitle('📦 Item Categories')
    .setDescription(`Select a category for **${username}**:`)
    .setColor('#0099ff')
    .addFields([
      { name: '👑 Seasonal Rank', value: 'Temporary ranks with special perks', inline: true },
      { name: '💎 Lifetime Rank', value: 'Permanent ranks with exclusive benefits', inline: true },
      { name: '🏗️ Claimblocks', value: 'Expand your territory protection', inline: true },
      { name: '🪙 Coins', value: 'In-game currency for purchases', inline: true },
      { name: '🗝️ Crate Keys', value: 'Unlock special items and rewards', inline: true },
      { name: '\u200b', value: '\u200b', inline: true }
    ]);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('category_select')
    .setPlaceholder('Choose an item category...')
    .addOptions([
      { 
        label: 'Seasonal Rank', 
        description: 'Temporary ranks with special perks', 
        value: `seasonal_${username}`,
        emoji: '👑'
      },
      { 
        label: 'Lifetime Rank', 
        description: 'Permanent ranks with exclusive benefits', 
        value: `lifetime_${username}`,
        emoji: '💎'
      },
      { 
        label: 'Claimblocks', 
        description: 'Expand your territory protection', 
        value: `claimblocks_${username}`,
        emoji: '🏗️'
      },
      { 
        label: 'Coins', 
        description: 'In-game currency for purchases', 
        value: `coins_${username}`,
        emoji: '🪙'
      },
      { 
        label: 'Crate Keys', 
        description: 'Unlock special items and rewards', 
        value: `cratekeys_${username}`,
        emoji: '🗝️'
      }
    ]);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const messageOptions = {
    embeds: [embed],
    components: [row],
    ephemeral: true
  };

  if (isUpdate) {
    await interaction.update(messageOptions);
  } else {
    await interaction.reply(messageOptions);
  }
}

async function showItemSelection(interaction, username, category) {
  const categoryDisplayName = getCategoryDisplayName(category);
  
  const embed = new EmbedBuilder()
    .setTitle(`${getCategoryEmoji(category)} ${categoryDisplayName}`)
    .setDescription(`Select a ${categoryDisplayName.toLowerCase()} for **${username}**:`)
    .setColor(getCategoryColor(category));

  // Add items as embed fields for better display
  const items = RANKS[category];
  const fields = items.map((item, index) => {
    let displayName = item.name;
    
    // Capitalize first letter for rank names (seasonal and lifetime)
    if (category === 'seasonal' || category === 'lifetime') {
      displayName = capitalizeFirstLetter(item.name);
    }
    
    return {
      name: displayName,
      value: item.price > 0 ? `₹${item.price}` : 'Coming Soon',
      inline: true
    };
  });

  embed.addFields(fields);

  const options = items.map((item, index) => {
    let displayName = item.name;
    
    // Capitalize first letter for rank names (seasonal and lifetime)
    if (category === 'seasonal' || category === 'lifetime') {
      displayName = capitalizeFirstLetter(item.name);
    }
    
    return {
      label: displayName,
      description: item.price > 0 ? `₹${item.price}` : 'Coming Soon',
      value: `${username}_${category}_${index}`
    };
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('item_select')
    .setPlaceholder(`Choose your ${categoryDisplayName.toLowerCase()}...`)
    .addOptions(options);

  const backButton = new ButtonBuilder()
    .setCustomId(`back_to_categories_${username}`)
    .setLabel('← Back to Categories')
    .setStyle(ButtonStyle.Secondary);

  const row1 = new ActionRowBuilder().addComponents(selectMenu);
  const row2 = new ActionRowBuilder().addComponents(backButton);

  await interaction.update({
    embeds: [embed],
    components: [row1, row2]
  });
}

function getCategoryEmoji(category) {
  const emojis = {
    seasonal: '👑',
    lifetime: '💎',
    claimblocks: '🏗️',
    coins: '🪙',
    cratekeys: '🗝️'
  };
  return emojis[category] || '📦';
}

function getCategoryColor(category) {
  const colors = {
    seasonal: '#ff6b35',
    lifetime: '#9b59b6',
    claimblocks: '#3498db',
    coins: '#f1c40f',
    cratekeys: '#e74c3c'
  };
  return colors[category] || '#0099ff';
}

async function showDiscountOption(interaction, username, selectedItem, category) {
  // Skip discount option for "Coming Soon" items
  if (selectedItem.name === 'Coming Soon') {
    await interaction.update({
      content: 'This item is coming soon and not available for purchase yet.',
      components: [],
      embeds: []
    });
    return;
  }

  // Get display name (capitalized for ranks)
  let displayItemName = selectedItem.name;
  if (category === 'seasonal' || category === 'lifetime') {
    displayItemName = capitalizeFirstLetter(selectedItem.name);
  }

  const embed = new EmbedBuilder()
    .setTitle('🎫 Discount Code')
    .setDescription(`**Item:** ${displayItemName}\n**Original Price:** ₹${selectedItem.price}\n**Player:** ${username}\n\nDo you have a discount code?`)
    .setColor('#ff9500');

  const applyDiscountButton = new ButtonBuilder()
    .setCustomId('apply_discount')
    .setLabel('🎫 Apply Discount Code')
    .setStyle(ButtonStyle.Primary);

  const skipDiscountButton = new ButtonBuilder()
    .setCustomId('skip_discount')
    .setLabel('➡️ Continue Without Discount')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(applyDiscountButton, skipDiscountButton);

  // Store session data for later use
  const userId = interaction.user.id;
  paymentSessions.set(userId, {
    username,
    selectedItem,
    category,
    displayItemName,
    originalPrice: selectedItem.price,
    discountApplied: false
  });

  await interaction.update({
    embeds: [embed],
    components: [row]
  });
}

async function showDiscountModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('discount_modal')
    .setTitle('Enter Discount Code');

  const discountInput = new TextInputBuilder()
    .setCustomId('discount_code')
    .setLabel('Discount Code')
    .setPlaceholder('Enter your discount code')
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const firstRow = new ActionRowBuilder().addComponents(discountInput);
  modal.addComponents(firstRow);
  await interaction.showModal(modal);
}

async function handleDiscountCode(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  const userId = interaction.user.id;
  const discountCode = interaction.fields.getTextInputValue('discount_code').trim().toUpperCase();
  
  if (!paymentSessions.has(userId)) {
    await interaction.followUp({ content: 'Session expired. Please start over.', ephemeral: true });
    return;
  }

  const session = paymentSessions.get(userId);
  
  try {
    // Check discount code validity
    const discountResult = await validateDiscountCode(discountCode, userId);
    
    if (!discountResult.valid) {
      // Show error and ask if user wants to continue without discount
      const embed = new EmbedBuilder()
        .setTitle('❌ Invalid Discount Code')
        .setDescription(`**Error:** ${discountResult.message}\n\nWould you like to continue with the original price?`)
        .setColor('#ff0000')
        .addFields([
          { name: 'Item', value: session.displayItemName, inline: true },
          { name: 'Original Price', value: `₹${session.originalPrice}`, inline: true }
        ]);

      const continueButton = new ButtonBuilder()
        .setCustomId('skip_discount')
        .setLabel('Continue Without Discount')
        .setStyle(ButtonStyle.Primary);

      const tryAgainButton = new ButtonBuilder()
        .setCustomId('apply_discount')
        .setLabel('Try Another Code')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(continueButton, tryAgainButton);

      await interaction.followUp({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
      return;
    }

    // Apply discount
    const discountAmount = Math.round(session.originalPrice * discountResult.percentage / 100);
    const finalPrice = session.originalPrice - discountAmount;

    // Update session with discount info
    session.discountApplied = true;
    session.discountCode = discountCode;
    session.discountPercentage = discountResult.percentage;
    session.discountAmount = discountAmount;
    session.finalPrice = finalPrice;
    paymentSessions.set(userId, session);

    const embed = new EmbedBuilder()
      .setTitle('✅ Discount Applied Successfully!')
      .setDescription(`Discount code **${discountCode}** has been applied!`)
      .setColor('#00ff00')
      .addFields([
        { name: 'Item', value: session.displayItemName, inline: true },
        { name: 'Original Price', value: `₹${session.originalPrice}`, inline: true },
        { name: 'Discount', value: `${discountResult.percentage}% (-₹${discountAmount})`, inline: true },
        { name: 'Final Price', value: `₹${finalPrice}`, inline: true }
      ]);

    const proceedButton = new ButtonBuilder()
      .setCustomId('skip_discount')
      .setLabel('Proceed to Payment')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(proceedButton);

    await interaction.followUp({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });

  } catch (error) {
    console.error('Error validating discount code:', error);
    await interaction.followUp({
      content: 'An error occurred while validating the discount code. Please try again.',
      ephemeral: true
    });
  }
}

async function proceedWithoutDiscount(interaction) {
  const userId = interaction.user.id;
  
  if (!paymentSessions.has(userId)) {
    await interaction.reply({ content: 'Session expired. Please start over.', ephemeral: true });
    return;
  }

  const session = paymentSessions.get(userId);
  await initiatePayment(interaction, session.username, session.selectedItem, session.category, session);
}

async function validateDiscountCode(code, userId) {
  try {
    // Get all discount codes from NocoDB
    const response = await axios.get(
      `${NOCODB_API_URL}/api/v2/tables/${DISCOUNT_TABLE_ID}/records`,
      {
        headers: { 'xc-token': NOCODB_API_TOKEN },
        params: {
          where: `(Discount_code,eq,${code})`
        }
      }
    );

    if (!response.data.list || response.data.list.length === 0) {
      return { valid: false, message: 'Discount code not found.' };
    }

    const discountRecord = response.data.list[0];
    
    // Check if code has remaining uses
    if (discountRecord.remaining_uses <= 0) {
      return { valid: false, message: 'This discount code has been fully used.' };
    }

    // Check if user has already used this code (for one-time use codes)
    if (discountRecord.Usage_Type === 'one-time' && discountRecord.Used_by) {
      const usedByList = discountRecord.Used_by.split(',').map(id => id.trim());
      if (usedByList.includes(userId)) {
        return { valid: false, message: 'You have already used this discount code.' };
      }
    }

    return {
      valid: true,
      percentage: discountRecord.Discount_Percentage,
      recordId: discountRecord.Id,
      usageType: discountRecord.Usage_Type,
      maxUses: discountRecord.max_uses,
      remainingUses: discountRecord.remaining_uses,
      usedBy: discountRecord.Used_by || ''
    };

  } catch (error) {
    console.error('Error validating discount code:', error);
    return { valid: false, message: 'Error validating discount code.' };
  }
}

async function updateDiscountCodeUsage(recordId, userId, usageType, usedBy, remainingUses) {
  try {
    let newUsedBy = usedBy;
    if (usedBy) {
      newUsedBy = `${usedBy},${userId}`;
    } else {
      newUsedBy = userId;
    }

    const updateData = {
      Used_by: newUsedBy,
      remaining_uses: remainingUses - 1
    };

    await axios.patch(
      `${NOCODB_API_URL}/api/v2/tables/${DISCOUNT_TABLE_ID}/records/${recordId}`,
      updateData,
      {
        headers: {
          'xc-token': NOCODB_API_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    return true;
  } catch (error) {
    console.error('Error updating discount code usage:', error);
    return false;
  }
}

async function initiatePayment(interaction, username, selectedItem, category, session = null) {
  try {
    // Add Discord user ID to the NocoDB entry
    const discordUserId = interaction.user.id;
    const discordUsername = interaction.user.username;
    
    // Use session data if available (with discount), otherwise use original item data
    const finalPrice = session && session.discountApplied ? session.finalPrice : selectedItem.price;
    const displayItemName = session ? session.displayItemName : (
      (category === 'seasonal' || category === 'lifetime') ? 
      capitalizeFirstLetter(selectedItem.name) : selectedItem.name
    );
    
    // Use lowercase name for database storage
    const dbItemName = selectedItem.name.toLowerCase();
    const paymentId = await createNocoDBEntry(username, {...selectedItem, name: dbItemName}, category, discordUserId, discordUsername, finalPrice, session);
    
    if (!paymentId) {
      const content = 'Error creating payment record. Please try again later.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
      return;
    }

    // Update discount code usage if discount was applied
    if (session && session.discountApplied) {
      const discountResult = await validateDiscountCode(session.discountCode, discordUserId);
      if (discountResult.valid) {
        await updateDiscountCodeUsage(
          discountResult.recordId, 
          discordUserId, 
          discountResult.usageType, 
          discountResult.usedBy, 
          discountResult.remainingUses
        );
      }
    }

    const qrCodeBuffer = await generatePaymentQR(finalPrice);
    const expiration = Date.now() + 2 * 60 * 1000; // 2 minutes

    const embed = new EmbedBuilder()
      .setTitle('💳 Payment Required')
      .setDescription(`**Item:** ${displayItemName}\n**Price:** ₹${finalPrice}\n**Player:** ${username}\n\nScan the QR code below to complete your payment`)
      .setImage('attachment://payment_qr.png')
      .setColor('#ffd700')
      .setFooter({ text: 'Payment expires in 2 minutes' });

    // Add discount info to embed if applied
    if (session && session.discountApplied) {
      embed.addFields([
        { name: 'Original Price', value: `₹${session.originalPrice}`, inline: true },
        { name: 'Discount Applied', value: `${session.discountPercentage}% (-₹${session.discountAmount})`, inline: true },
        { name: 'Discount Code', value: session.discountCode, inline: true }
      ]);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_payment')
        .setLabel('✅ I have paid')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('cancel_payment')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Danger)
    );

    const initialSeconds = Math.ceil((expiration - Date.now()) / 1000);
    
    // Send the initial message with QR code
    let message;
    if (interaction.replied || interaction.deferred) {
      message = await interaction.followUp({
        content: `⏳ **Time remaining:** ${initialSeconds}s`,
        embeds: [embed],
        files: [{ attachment: qrCodeBuffer, name: 'payment_qr.png' }],
        components: [row],
        fetchReply: true
      });
    } else {
      message = await interaction.reply({
        content: `⏳ **Time remaining:** ${initialSeconds}s`,
        embeds: [embed],
        files: [{ attachment: qrCodeBuffer, name: 'payment_qr.png' }],
        components: [row],
        fetchReply: true
      });
    }

    const userId = interaction.user.id;
    
    // Create a separate function for updating just the countdown text
    const updateCountdown = async () => {
      try {
        const remainingTime = Math.max(0, Math.ceil((expiration - Date.now()) / 1000));
        
        // Only update the content text without changing the embed or files to prevent QR blinking
        await interaction.editReply({
          content: `⏳ **Time remaining:** ${remainingTime}s`,
          components: [row]
        });
      } catch (err) {
        console.error('Failed to update countdown:', err);
      }
    };

    // Update more frequently - every 5 seconds
    const countdownInterval = setInterval(updateCountdown, 5000);

    const timeout = setTimeout(async () => {
      clearInterval(countdownInterval);
      await updateNocoDBEntry(paymentId, 'expired');
      
      try {
        await interaction.editReply({
          content: `⏰ Payment expired for **${username}** - ${displayItemName} (₹${finalPrice})`,
          embeds: [],
          components: [],
          files: []
        });
      } catch (err) {
        console.error('Failed to update expired message:', err);
      }
      
      paymentSessions.delete(userId);
    }, 2 * 60 * 1000); // 2 minutes

    paymentSessions.set(userId, {
      username,
      rank: displayItemName,
      price: selectedItem.price,
      finalPrice: finalPrice,
      paymentId,
      timeout,
      interval: countdownInterval,
      expiration: expiration,
      interaction: interaction,
      discountApplied: session && session.discountApplied,
      discountCode: session && session.discountCode
    });
  } catch (error) {
    console.error('Error initiating payment:', error);
    const content = 'An error occurred while initiating payment.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
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
      clearInterval(session.interval);
      
      // Update the original payment message
      try {
        let successMessage = `✅ **Payment Completed!**\n\n**Player:** ${session.username}\n**Item:** ${session.rank}\n**Amount:** ₹${session.finalPrice || session.price}\n\nYour purchase has been activated!`;
        
        if (session.discountApplied) {
          successMessage += `\n**Discount Code Used:** ${session.discountCode}`;
        }

        await session.interaction.editReply({
          content: successMessage,
          embeds: [],
          components: [],
          files: []
        });
      } catch (err) {
        console.error('Failed to update payment success message:', err);
      }

      await interaction.follow
