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
const BAD_WORDS = ['badword1', 'badword2', 'badword3']; // Replace these
const MOD_ROLE_NAME = 'mod'; // Customize your moderator role name

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

  // === Auto-moderation ===
  for (const word of BAD_WORDS) {
    if (content.includes(word)) {
      try {
        await message.delete();
        await message.channel.send(`${message.author}, please avoid using that word.`);
      } catch (err) {
        console.error('Moderation error:', err);
      }
      return;
    }
  }

  // === Ticket: Create ===
  if (content === '!ticket') {
    const existing = message.guild.channels.cache.find(
      (ch) => ch.name === `ticket-${message.author.id}`
    );
    if (existing) return message.reply(`You already have a ticket: ${existing}`);

    const modRole = message.guild.roles.cache.find(
      (r) => r.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase()
    );

    const channel = await message.guild.channels.create({
      name: `ticket-${message.author.id}`,
      type: 0,
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
          id: modRole?.id || message.guild.ownerId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });

    await channel.send(`Hello ${message.author}, describe your issue. A moderator will be with you soon.`);
    return message.reply(`✅ Ticket created: ${channel}`);
  }

  // === Ticket: Close ===
  if (content === '!close') {
    if (!isTicketChannel(message.channel)) {
      return message.reply('You can only use this inside a ticket channel.');
    }

    const modRole = message.guild.roles.cache.find(
      (r) => r.name.toLowerCase() === MOD_ROLE_NAME.toLowerCase()
    );

    if (
      message.author.id !== message.channel.name.split('ticket-')[1] &&
      !member.roles.cache.has(modRole?.id)
    ) {
      return message.reply("Only the ticket creator or a moderator can close this ticket.");
    }

    await message.channel.send('Closing this ticket in 5 seconds...');
    setTimeout(() => {
      message.channel.delete().catch(() => {});
    }, 5000);
    return;
  }

  // === AI Chat via Groq API ===
  const shouldReply =
    isTicketChannel(message.channel) ||
    message.mentions.has(client.user) ||
    content.includes('mr bot') ||
    content.includes('mr_bot') ||
    content.includes('mrbot');

  if (shouldReply) {
    try {
      const prompt = message.content.replace(/<@!?(\d+)>/g, '').replace(/mr[\s_]?bot/gi, '').trim();

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [
            { role: 'user', content: prompt || "Hello, how can I help you?" }
          ],
        }),
      });

      const data = await response.json();

      const reply = data.choices?.[0]?.message?.content || "Sorry, I had a brain freeze.";

      await message.reply(reply);
    } catch (err) {
      console.error('Groq API error:', err);
      await message.reply("Oops, I couldn't think of a response.");
    }
  }
});

client.login(process.env.TOKEN);
