const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
require("dotenv").config();
const fetch = require("node-fetch");

// Create the Discord client with proper intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// === CONFIG - REPLACE THESE WITH YOUR ACTUAL IDs ===
const HELP_CHANNEL_ID = "1374671416439472148";
const TICKET_CATEGORY_ID = "1379112243177717842";
const STAFF_ROLE_ID = "1374444076702634137";

// Map to track user cooldown on ticket creation to prevent spam
const ticketCooldown = new Map();

// Map to keep conversation history for AI chat in tickets
const conversationHistory = new Map();

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Ensure the open ticket button exists in the help channel
  const helpChannel = await client.channels.fetch(HELP_CHANNEL_ID);
  const messages = await helpChannel.messages.fetch({ limit: 10 });

  // Only send the ticket button message if none exists yet
  if (!messages.some((msg) => msg.author.id === client.user.id)) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_ticket")
        .setLabel("🎫 Open Ticket")
        .setStyle(ButtonStyle.Primary)
    );

    await helpChannel.send({
      content: "**Need help?** Click the button below to create a private support ticket.",
      components: [row],
    });
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild } = interaction;

  if (customId === "create_ticket") {
    const now = Date.now();
    const lastClick = ticketCooldown.get(user.id);

    // Spam prevention: if clicked within 10 seconds
    if (lastClick && now - lastClick < 10000) {
      // Find all user tickets and delete them
      const userTickets = guild.channels.cache.filter(
        (c) => c.name === `ticket-${user.username.toLowerCase()}`
      );
      for (const channel of userTickets.values()) {
        await channel.delete().catch(() => {});
      }

      // Timeout user 10 minutes
      try {
        const member = await guild.members.fetch(user.id);
        await member.timeout(10 * 60 * 1000, "Spamming ticket creation");
        await interaction.reply({
          content: "⛔ You were spamming tickets and have been timed out for 10 minutes.",
          ephemeral: true,
        });
      } catch (error) {
        console.error("Timeout failed:", error);
        await interaction.reply({
          content: "❌ You are spamming tickets. Please wait before trying again.",
          ephemeral: true,
        });
      }
      return;
    }

    ticketCooldown.set(user.id, now);

    // Check if user already has an open ticket
    const existingTicket = guild.channels.cache.find(
      (c) => c.name === `ticket-${user.username.toLowerCase()}`
    );
    if (existingTicket) {
      return interaction.reply({
        content: "📬 You already have an open ticket.",
        ephemeral: true,
      });
    }

    // Create a new ticket channel
    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
        {
          id: STAFF_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `🎫 <@${user.id}>, your ticket is now open! How can we assist you today?`,
      components: [closeRow],
    });

    await interaction.reply({ content: "✅ Your ticket has been created.", ephemeral: true });
  }

  if (customId === "close_ticket") {
    await interaction.reply("🕐 Closing this ticket in 5 seconds...");
    setTimeout(() => {
      interaction.channel.delete().catch(console.error);
    }, 5000);
  }
});

client.on("messageCreate", async (message) => {
  if (
    message.author.bot ||
    !message.guild ||
    !message.channel.name.startsWith("ticket-")
  )
    return;

  // Track conversation history (limit last 6 messages per user)
  const userId = message.author.id;
  const history = conversationHistory.get(userId)?.history || [];

  history.push({ role: "user", content: message.content });

  // Call AI (Groq) API
  const reply = await fetchFromGroq(history);

  if (!reply) return;

  history.push({ role: "assistant", content: reply });
  conversationHistory.set(userId, {
    history: history.slice(-6),
    timestamp: Date.now(),
  });

  // Send reply chunked to stay within Discord limits
  for (const chunk of splitMessage(reply)) {
    await message.channel.send(chunk);
  }
});

// Fetch AI response from Groq API
async function fetchFromGroq(messages) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
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
    return "⚠️ Sorry, I am currently unable to respond.";
  }
}

// Split long messages into 2000-char chunks for Discord
function splitMessage(text, maxLength = 2000) {
  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

client.login(process.env.DISCORD_BOT_TOKEN);
