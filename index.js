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
const DISCOUNT_TABLE_ID = process.env.DISCOUNT_TABLE_ID;
const DISCOUNT_VIEW_ID = process.env.DISCOUNT_VIEW_ID;
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
    { name: '100 Bitkoinz', price: 25, numeric_value: 100 },
    { name: '250 Bitkoinz', price: 60, numeric_value: 250 },
    { name: '500 Bitkoinz', price: 120, numeric_value: 500 },
    { name: '1000 Bitkoinz', price: 200, numeric_value: 1000 },
    { name: '2.5k Bitkoinz', price: 450, numeric_value: 2500 },
    { name: '5k Bitkoinz', price: 800, numeric_value: 5000 }
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
    coins: 'Bitkoinz',
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
              content: `Payment cancelled for **${session.username}** - ${session.rank} (₹${session.finalPrice})`,
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
      } else if (interaction.customId === 'try_another_discount') {
        await showDiscountModal(interaction);
      } else if (interaction.customId === 'proceed_without_discount') {
        const userId = interaction.user.id;
        if (paymentSessions.has(userId)) {
          const session = paymentSessions.get(userId);
          await proceedToPayment(interaction, session.username, session.selectedItem, session.category, null);
        } else {
          await interaction.reply({ content: 'No active session found.', ephemeral: true });
        }
      }
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'username_modal') {
        const username = interaction.fields.getTextInputValue('minecraft_username');
        await showCategorySelection(interaction, username);
      } else if (interaction.customId === 'discount_modal') {
        const discountCode = interaction.fields.getTextInputValue('discount_code');
        await processDiscountCode(interaction, discountCode);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'category_select') {
        const username = interaction.values[0].split('_')[1];
        const category = interaction.values[0].split('_')[0];
        await showItemSelection(interaction, username, category);
      } else if (interaction.customId === 'item_select') {
        const [username, category, itemIndex] = interaction.values[0].split('_');
        const selectedItem = RANKS[category][parseInt(itemIndex)];
        await showDiscountOptions(interaction, username, selectedItem, category);
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
      { name: '🪙 Bitkoinz', value: 'In-game currency for purchases', inline: true },
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
        label: 'Bitkoinz', 
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

async function showDiscountOptions(interaction, username, selectedItem, category) {
  // Skip discount options for "Coming Soon" items
  if (selectedItem.name === 'Coming Soon') {
    await interaction.update({
      content: 'This item is coming soon and not available for purchase yet.',
      components: [],
      embeds: []
    });
    return;
  }

  // Store session data for discount processing
  const userId = interaction.user.id;
  paymentSessions.set(userId, {
    username,
    selectedItem,
    category
  });

  // Get display name (capitalized for ranks)
  let displayItemName = selectedItem.name;
  if (category === 'seasonal' || category === 'lifetime') {
    displayItemName = capitalizeFirstLetter(selectedItem.name);
  }

  const embed = new EmbedBuilder()
    .setTitle('🎫 Discount Code')
    .setDescription(`**Item:** ${displayItemName}\n**Original Price:** ₹${selectedItem.price}\n**Player:** ${username}\n\nDo you have a discount code?`)
    .setColor('#00ff00');

  const applyDiscountButton = new ButtonBuilder()
    .setCustomId('apply_discount')
    .setLabel('🎫 Apply Discount Code')
    .setStyle(ButtonStyle.Primary);

  const proceedButton = new ButtonBuilder()
    .setCustomId('proceed_without_discount')
    .setLabel('Continue Without Discount')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder().addComponents(applyDiscountButton, proceedButton);

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

async function processDiscountCode(interaction, discountCode) {
  await interaction.deferReply({ ephemeral: true });

  const userId = interaction.user.id;
  if (!paymentSessions.has(userId)) {
    await interaction.followUp({ content: 'No active session found.', ephemeral: true });
    return;
  }

  const session = paymentSessions.get(userId);
  
  try {
    const discountData = await validateDiscountCode(discountCode, userId);
    
    if (!discountData.valid) {
      // Show invalid code message with options to try another code or continue
      const embed = new EmbedBuilder()
        .setTitle('❌ Invalid Discount Code')
        .setDescription(`The discount code "${discountCode}" is ${discountData.reason}.\n\nWhat would you like to do?`)
        .setColor('#ff0000');

      const tryAnotherButton = new ButtonBuilder()
        .setCustomId('try_another_discount')
        .setLabel('🔄 Try Another Code')
        .setStyle(ButtonStyle.Primary);

      const continueButton = new ButtonBuilder()
        .setCustomId('proceed_without_discount')
        .setLabel('Continue at Original Price')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(tryAnotherButton, continueButton);

      await interaction.followUp({
        embeds: [embed],
        components: [row],
        ephemeral: true
      });
      return;
    }

    // Valid discount code - proceed with discount
    await proceedToPayment(interaction, session.username, session.selectedItem, session.category, discountData);

  } catch (error) {
    console.error('Error processing discount code:', error);
    
    // Show detailed error message with options
    const embed = new EmbedBuilder()
      .setTitle('❌ Error Processing Discount Code')
      .setDescription(`An error occurred while checking the discount code "${discountCode}".\n\nThis could be due to:\n• Database connection issues\n• Invalid discount code format\n• Server error\n\nWhat would you like to do?`)
      .setColor('#ff0000');

    const tryAnotherButton = new ButtonBuilder()
      .setCustomId('try_another_discount')
      .setLabel('🔄 Try Another Code')
      .setStyle(ButtonStyle.Primary);

    const continueButton = new ButtonBuilder()
      .setCustomId('proceed_without_discount')
      .setLabel('Continue at Original Price')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(tryAnotherButton, continueButton);

    await interaction.followUp({
      embeds: [embed],
      components: [row],
      ephemeral: true
    });
  }
}

async function validateDiscountCode(discountCode, userId) {
  try {
    console.log(`Validating discount code: ${discountCode} for user: ${userId}`);
    console.log(`NocoDB URL: ${NOCODB_API_URL}`);
    console.log(`Discount Table ID: ${DISCOUNT_TABLE_ID}`);
    
    // Fetch discount codes from NocoDB
    const response = await axios.get(
      `${NOCODB_API_URL}/api/v2/tables/${DISCOUNT_TABLE_ID}/records`,
      {
        headers: { 'xc-token': NOCODB_API_TOKEN },
        params: {
          where: `(discount_code,eq,${discountCode})`
        }
      }
    );

    console.log(`NocoDB Response Status: ${response.status}`);
    console.log(`NocoDB Response Data:`, JSON.stringify(response.data, null, 2));

    const discounts = response.data.list;
    if (discounts.length === 0) {
      return { valid: false, reason: 'not found' };
    }

    const discount = discounts[0];
    console.log(`Found discount:`, JSON.stringify(discount, null, 2));
    
    // Check if discount has remaining uses
    if (discount.remaining_uses <= 0) {
      return { valid: false, reason: 'expired (no remaining uses)' };
    }
    
    // FIXED: Check if user has already used this code (for one-time codes)
    if (discount.usage_type === 'one_time') {
      const usedBy = discount.used_by || '';
      console.log(`Checking if user ${userId} has used code. Used by: "${usedBy}"`);
      
      // Handle both empty string and null/undefined cases
      if (usedBy) {
        const usedByArray = usedBy
          .split(',')
          .map(id => id.trim())
          .filter(id => id !== ''); // Remove empty strings
        
        console.log(`Used by array:`, usedByArray);
        console.log(`Checking if ${String(userId)} is in array`);
        
        // Convert both to strings for comparison
        if (usedByArray.includes(String(userId))) {
          console.log(`User ${userId} has already used this code`);
          return { valid: false, reason: 'already used by you' };
        }
      }
    }

    return {
      valid: true,
      id: discount.Id,
      discountPercentage: discount.discount_percentage,
      usedBy: discount.used_by || '',
      remainingUses: discount.remaining_uses,
      usageType: discount.usage_type
    };

  } catch (error) {
    console.error('Error validating discount code:', error);
    
    // Log more details about the error
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
      console.error('Response Headers:', error.response.headers);
    } else if (error.request) {
      console.error('Request Error:', error.request);
    } else {
      console.error('Error Message:', error.message);
    }
    
    // Re-throw the error so it can be handled in processDiscountCode
    throw error;
  }
}


async function updateDiscountCodeUsage(discountId, userId, currentUsedBy, remainingUses) {
  try {
    // Add user ID to used_by list
    const usedByArray = currentUsedBy.split(',').filter(id => id.trim() !== '');
    usedByArray.push(userId);
    const newUsedBy = usedByArray.join(',');

    // Decrease remaining uses
    const newRemainingUses = remainingUses - 1;

    await axios.patch(
      `${NOCODB_API_URL}/api/v2/tables/${DISCOUNT_TABLE_ID}/records`,
      {
        Id: discountId,
        used_by: newUsedBy,
        remaining_uses: newRemainingUses
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
    console.error('Error updating discount code usage:', error);
    return false;
  }
}

async function proceedToPayment(interaction, username, selectedItem, category, discountData) {
  try {
    let finalPrice = selectedItem.price;
    let discountAmount = 0;
    
    if (discountData) {
      discountAmount = (selectedItem.price * discountData.discountPercentage) / 100;
      finalPrice = selectedItem.price - discountAmount;
      
      // Update discount code usage
      await updateDiscountCodeUsage(
        discountData.id,
        interaction.user.id,
        discountData.usedBy,
        discountData.remainingUses
      );
    }
    
    // Add Discord user ID to the NocoDB entry
    const discordUserId = interaction.user.id;
    const discordUsername = interaction.user.username;
    
    // Use lowercase name for database storage
    const dbItemName = selectedItem.name.toLowerCase();
    const paymentId = await createNocoDBEntry(
      username, 
      {...selectedItem, name: dbItemName}, 
      category, 
      discordUserId, 
      discordUsername,
      finalPrice,
      discountAmount
    );
    
    if (!paymentId) {
      const content = 'Error creating payment record. Please try again later.';
      if (interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.update({
          content,
          components: [],
          embeds: []
        });
      }
      return;
    }

    const qrCodeBuffer = await generatePaymentQR(finalPrice);
    const expiration = Date.now() + 2 * 60 * 1000; // 2 minutes

    // Get display name (capitalized for ranks)
    let displayItemName = selectedItem.name;
    if (category === 'seasonal' || category === 'lifetime') {
      displayItemName = capitalizeFirstLetter(selectedItem.name);
    }

    const embed = new EmbedBuilder()
      .setTitle('💳 Payment Required')
      .setColor('#ffd700')
      .setFooter({ text: 'Payment expires in 2 minutes' });

    let description = `**Item:** ${displayItemName}\n**Player:** ${username}\n`;
    
    if (discountData) {
      description += `**Original Price:** ₹${selectedItem.price}\n**Discount:** -₹${discountAmount} (${discountData.discountPercentage}%)\n**Final Price:** ₹${finalPrice}\n\n`;
    } else {
      description += `**Price:** ₹${finalPrice}\n\n`;
    }
    
    description += 'Scan the QR code below to complete your payment';
    embed.setDescription(description);
    embed.setImage('attachment://payment_qr.png');

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
    
    // Send the payment message
    let message;
    if (interaction.deferred) {
      message = await interaction.followUp({
        content: `⏳ **Time remaining:** ${initialSeconds}s`,
        embeds: [embed],
        files: [{ attachment: qrCodeBuffer, name: 'payment_qr.png' }],
        components: [row],
        ephemeral: true
      });
    } else {
      message = await interaction.update({
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
        if (interaction.deferred) {
          await interaction.editReply({
            content: `⏳ **Time remaining:** ${remainingTime}s`,
            components: [row]
          });
        } else {
          await interaction.editReply({
            content: `⏳ **Time remaining:** ${remainingTime}s`,
            components: [row]
          });
        }
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
      interaction: interaction
    });
  } catch (error) {
    console.error('Error proceeding to payment:', error);
    const content = 'An error occurred while processing your payment.';
    if (interaction.deferred) {
      await interaction.followUp({ content, ephemeral: true });
    } else {
      await interaction.update({
        content,
        components: [],
        embeds: []
      });
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
        await session.interaction.editReply({
          content: `✅ **Payment Completed!**\n\n**Player:** ${session.username}\n**Item:** ${session.rank}\n**Amount:** ₹${session.finalPrice}\n\nYour purchase has been activated!`,
          embeds: [],
          components: [],
          files: []
        });
      } catch (err) {
        console.error('Failed to update payment success message:', err);
      }

      await interaction.followUp({ content: '🎉 Your purchase has been successfully activated!', ephemeral: true });
      paymentSessions.delete(userId);
    } else {
      await interaction.followUp({
        content: '⏳ Payment not verified yet. Please try again in a few seconds.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    await interaction.followUp({
      content: '❌ An error occurred while verifying your payment.',
      ephemeral: true
    });
  }
}

async function createNocoDBEntry(username, selectedItem, category, discordUserId, discordUsername, finalPrice = null, discountAmount = null) {
  try {
    // For claimblocks and coins, use the numeric value when saving to database
    let itemValue;
    
    if ((category === 'claimblocks' || category === 'coins') && selectedItem.numeric_value !== undefined) {
      itemValue = selectedItem.numeric_value.toString();
    } else {
      itemValue = selectedItem.name; // This will now be lowercase for ranks
    }
    
    const entryData = {
      minecraft_username: username,
      rank_name: itemValue,
      amount: finalPrice || selectedItem.price,
      status: 'pending',
      session_id: discordUserId,
      discord_username: discordUsername,
      category: category,
      original_amount: selectedItem.price
    };

    // Add discount information if applicable
    if (discountAmount !== null) {
      entryData.original_amount = selectedItem.price;
      entryData.discount_amount = discountAmount;
    }
    
    const response = await axios.post(
      `${NOCODB_API_URL}/api/v2/tables/${TABLE_ID}/records`,
      entryData,
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
    const paymentLink = `upi://pay?pa=${UPI_ID}&pn=${UPI_NAME}&mc=0000&tid=${Date.now()}&am=${amount}&currency=INR&name=Rank%20Purchase`;
    return await QRCode.toBuffer(paymentLink, { errorCorrectionLevel: 'H' });
  } catch (error) {
    console.error('Error generating QR code:', error);
    return null;
  }
}

client.login(process.env.DISCORD_TOKEN);
