const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`✅ Mr_Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  const isMentioned = message.mentions.has(client.user);
  const nameMentioned =
    content.includes('mr_bot') ||
    content.includes('mr bot') ||
    content.includes('mrbot');

  if (isMentioned || nameMentioned) {
    message.reply("👋 You called Mr_Bot? I'm here to help!");
  }
});

client.login(process.env.TOKEN);
