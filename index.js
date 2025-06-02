const { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  ChannelType, 
  PermissionsBitField, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require("discord.js");
require("dotenv").config();
const fetch = require("node-fetch");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.MessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ======= CONFIGURATION =======
const HELP_CHANNEL_ID = "YOUR_HELP_CHANNEL_ID"; // e.g. "123456789012345678"
const TICKET_CATEGORY_ID = "YOUR_TICKET_CATEGORY_ID"; // e.g. "123456789012345678"
const STAFF_ROLE_ID = "YOUR_STAFF_ROLE_ID"; // e.g. "123456789012345678"
const TICKET_COOLDOWN_TIME = 10 * 1000; // 10 seconds cooldown on ticket creation
const TICKET_TIMEOUT_DURATION = 10 * 60 * 1000; // 10 minutes timeout on spam

// For spam prevention cooldown and conversation tracking
const ticketCooldown = new Map();
const conversationHistory = new Map();

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Ensure the ticket creation button is in the help channel
  const helpChannel = await client.channels.fetch(HELP_CHANNEL_ID);
  const messages = await helpChannel.messages.fetch({ limit: 10 });
  
  // If no recent button message found, send it
  if (!messages.some(m => m.components.length > 0)) {
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

// Interaction handling: create/close ticket buttons
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild } = interaction;

  if (customId === "create_ticket") {
    const now = Date.now();
    const lastUsed = ticketCooldown.get(user.id);

    // Spam detection: user clicked within cooldown period
    if (lastUsed && now - lastUsed < TICKET_COOLDOWN_TIME) {
      // Delete all user's tickets (channels named ticket-username)
      const userTickets = guild.channels.cache.filter(
        (c) => c.name === `ticket-${user.username.toLowerCase()}`
      );
      for (const ch of userTickets.values()) {
        try {
          await ch.delete();
        } catch {}
      }

      // Timeout user for spamming
      try {
        const member = await guild.members.fetch(user.id);
        await member.timeout(TICKET_TIMEOUT_DURATION, "Spamming ticket creation");
        await interaction.reply({
          content: "⛔ You were spamming ticket creation and have been timed out for 10 minutes.",
          ephemeral: true,
        });
      } catch (error) {
        console.error("Failed to timeout user:", error);
        await interaction.reply({
          content: "❌ Please do not spam ticket creation.",
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

    // Create ticket channel
    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID || null,
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
          id: STAFF_ROLE_ID,
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
      ],
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("🔒 Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `🎫 Hello <@${user.id}>, your support ticket has been opened. How can I assist you today?`,
      components: [closeRow],
    });

    await interaction.reply({ content: "✅ Your ticket has been created.", ephemeral: true });
  }

  if (customId === "close_ticket") {
    if (!interaction.channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "This button can only be used inside ticket channels.", ephemeral: true });
    }

    await interaction.reply("🕐 Closing this ticket in 5 seconds...");
    setTimeout(() => {
      interaction.channel.delete().catch(console.error);
    }, 5000);
  }
});

// Listen to messages inside ticket channels for AI chat
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  if (!message.channel.name.startsWith("ticket-")) return;

  const userId = message.author.id;
  const pastMessages = conversationHistory.get(userId)?.history || [];

  // Add user message to history
  pastMessages.push({ role: "user", content: message.content });

  // Call AI API (Groq example)
  const aiReply = await fetchFromGroq(pastMessages);

  if (!aiReply) return;

  pastMessages.push({ role: "assistant", content: aiReply });

  // Keep last 6 messages max
  conversationHistory.set(userId, {
    history: pastMessages.slice(-6),
    timestamp: Date.now(),
  });

  // Send reply in chunks if too long
  const chunks = splitMessage(aiReply);
  for (const chunk of chunks) {
    await message.channel.send(chunk);
  }
});

// --- AI chat using Groq API ---
async function fetchFromGroq(messages) {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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

    const data = await res.json();
    return data.choices?.[0]?.message?.content.trim();
  } catch (error) {
    console.error("Groq API error:", error);
    return "⚠️ Sorry, I'm having trouble responding right now.";
  }
}

// Split messages > 2000 chars into smaller chunks to avoid Discord limits
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
