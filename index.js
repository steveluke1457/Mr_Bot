const { Client, GatewayIntentBits } = require("discord.js");
const fetch = require("node-fetch");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  if (content.includes("mr_bot") || content.includes("mr bot") || content.includes("mrbot")) {
    await message.channel.sendTyping();
    const reply = await fetchFromGroq(message.content);
    message.reply(reply);
  }
});

async function fetchFromGroq(userMessage) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "🤖 I couldn’t generate a response.";
  } catch (err) {
    console.error(err);
    return "⚠️ Error talking to AI.";
  }
}

client.login(process.env.DISCORD_BOT_TOKEN);
