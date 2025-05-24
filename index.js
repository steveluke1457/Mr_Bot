require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('/ai')) {
    const prompt = message.content.replace('/ai', '').trim();
    if (!prompt) return message.reply('Please enter a prompt.');

    try {
      const response = await axios.post(
        'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1',
        { inputs: prompt },
        {
          headers: {
            Authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
          },
        }
      );

      const output = response.data[0]?.generated_text || "No response.";
      message.reply(output);
    } catch (err) {
      console.error(err);
      message.reply("There was an error contacting Hugging Face.");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
