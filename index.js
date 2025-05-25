const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const fetch = require('node-fetch');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// === Config ===
const BAD_WORDS = ['badword1', 'badword2', 'badword3']; // Replace with your bad words
const MOD_ROLE_NAME = 'mod'; // Adjust to your mod role name

// Helper to check if a channel is a ticket channel
function isTicketChannel(channel) {
  return channel.name.startsWith('ticket-');
}

client.once('ready', () => {
  console.log(`✅ Mr_Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const member = message.member;

  // === 2. Auto-moderation ===
  for (const badWord of BAD_WORDS) {
    if (content.includes(badWord)) {
      try {
        await message.delete();
        await message.channel.send(
          `${message.author}, your message contained a banned word and was removed.`
        );
      } catch {
        // ignore permission errors
      }
      return; // stop processing further
    }
  }

  // === 1. Ticket System Commands ===

  if (content === '!ticket') {
    // Check if ticket exists
    const existing = message.guild.channels.cache.find(
      (ch) => ch.name === `ticket-${message.author.id}`
    );
    if (existing) {
      return message.reply(`You already have an open ticket: ${existing}`);
    }

    // Create ticket channel
    const modRole = message.guild.roles.cache.find(
      (r) => r.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase()
    );

    const ticketChannel = await message.guild.channels.create({
      name: `ticket-${message.author.id}`,
      type: 0, // GUILD_TEXT
      permissionOverwrites: [
        {
          id: message.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: message.author.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: modRole ? modRole.id : message.guild.ownerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });

    ticketChannel.send(
      `Hello ${message.author}, thank you for opening a ticket! Please describe your issue.`
    );

    return message.reply(`Your ticket has been created: ${ticketChannel}`);
  }

  // Close ticket command
  if (content === '!close') {
    if (!isTicketChannel(message.channel)) {
      return message.reply('This command can only be used inside a ticket channel.');
    }

    // Only author or mod can close
    const modRole = message.guild.roles.cache.find(
      (r) => r.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase()
    );

    if (
      message.author.id !== message.channel.name.split('ticket-')[1] &&
      !member.roles.cache.has(modRole?.id)
    ) {
      return message.reply("Only the ticket creator or mods can close this ticket.");
    }

    await message.channel.send('Closing this ticket in 5 seconds...');
    setTimeout(() => {
      message.channel.delete().catch(() => {});
    }, 5000);
    return;
  }

  // === 3. AI Chat inside tickets only ===
  if (isTicketChannel(message.channel)) {
    // Bot only replies to user messages in ticket channels
    if (message.author.bot) return;

    // Strip the name if any
    const prompt = message.content;

    try {
      const response = await fetch('https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.HF_TOKEN || ''}`, // Optional HF token
        },
        body: JSON.stringify({ inputs: prompt }),
      });

      const data = await response.json();
      const botReply = data.generated_text || "Sorry, I'm thinking too hard 😅";

      await message.channel.send(botReply);
    } catch (error) {
      console.error('AI Error:', error);
      await message.channel.send("Oops! I had a brain freeze. Try again.");
    }

    return;
  }

  // === Outside tickets: respond to mentions or name ===
  const isMentioned = message.mentions.has(client.user);
  const nameMentioned =
    content.includes('mr_bot') || content.includes('mr bot') || content.includes('mrbot');

  if (isMentioned || nameMentioned) {
    await message.reply("👋 You called Mr_Bot? I'm here to help!");
  }
});

client.login(process.env.TOKEN);
