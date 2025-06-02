const { Client, GatewayIntentBits } = require("discord.js");
const fetch = require("node-fetch");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const conversationHistory = new Map();

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const triggered = content.includes("mr_bot") || content.includes("mr bot") || content.includes("mrbot");

  const userId = message.author.id;
  const isOngoing = conversationHistory.has(userId) &&
    Date.now() - conversationHistory.get(userId).timestamp < 3 * 60 * 1000;

  if (triggered || isOngoing) {
    await message.channel.sendTyping();

    const pastMessages = conversationHistory.get(userId)?.history || [];
    pastMessages.push({ role: "user", content: message.content });

    const reply = await fetchFromGroq(pastMessages);
    if (!reply) return;

    pastMessages.push({ role: "assistant", content: reply });

    // Update conversation memory (limit to last 6 exchanges)
    conversationHistory.set(userId, {
      history: pastMessages.slice(-6),
      timestamp: Date.now(),
    });

    // Send in 2000-char chunks
    const chunks = splitMessage(reply);
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  }
});

async function fetchFromGroq(messages) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages,
      }),
    });

    const data = await response.json();
    return data.choices?.[0]?.message?.content.trim();
  } catch (err) {
    console.error("Groq API error:", err);
    return "⚠️ Sorry, I had trouble thinking just now.";
  }
}

function splitMessage(text, maxLength = 2000) {
  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += "\n" + line;
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}

client.login(process.env.DISCORD_BOT_TOKEN);
