const { 
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle 
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
  partials: [Partials.Channel],
});

// IDs
const HELP_CHANNEL_ID = "1374671416439472148";
const TICKET_CATEGORY_ID = "1379112243177717842";
const STAFF_ROLE_ID = "1374444076702634137";
const COUNTING_CHANNEL_ID = "1375514672433991680";

// Cooldown map for ticket spam detection
const ticketCooldown = new Map();
// Conversation history per user (for AI chat)
const conversationHistory = new Map();
// Counting state per channel (for counting channel only)
const countingState = new Map();

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Send the ticket button if not exists in HELP_CHANNEL_ID
  const helpChannel = await client.channels.fetch(HELP_CHANNEL_ID);
  const existingMessages = await helpChannel.messages.fetch({ limit: 10 });
  if (existingMessages.size === 0) {
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

    // Spam detection: multiple clicks within 10 seconds
    if (lastClick && now - lastClick < 10_000) {
      // Delete all user's tickets
      const userTickets = guild.channels.cache.filter(c =>
        c.name === `ticket-${user.username.toLowerCase()}`
      );
      userTickets.forEach(channel => channel.delete().catch(() => {}));

      // Timeout user 10 minutes
      try {
        const member = await guild.members.fetch(user.id);
        await member.timeout(10 * 60 * 1000, "Spamming ticket system");
        await interaction.reply({
          content: "⛔ You were spamming tickets and have been timed out for 10 minutes.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("Timeout failed:", err);
        await interaction.reply({
          content: "❌ You are spamming tickets. Please wait before trying again.",
          ephemeral: true,
        });
      }

      console.log(`[⚠️] ${user.tag} timed out for ticket spam.`);
      return;
    }

    ticketCooldown.set(user.id, now);

    // Check if user already has a ticket
    const existing = guild.channels.cache.find(c =>
      c.name === `ticket-${user.username.toLowerCase()}`
    );
    if (existing) {
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
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
        {
          id: client.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
        {
          id: STAFF_ROLE_ID,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
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
      content: `🎫 <@${user.id}>, your support ticket has been opened. How can I assist you?`,
      components: [closeRow],
    });

    await interaction.reply({ content: "✅ Your ticket has been created.", ephemeral: true });
  }

  if (customId === "close_ticket") {
    const channel = interaction.channel;
    await interaction.reply("🕐 Closing this ticket in 5 seconds...");
    setTimeout(() => {
      channel.delete().catch(console.error);
    }, 5000);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  // COUNTING LOGIC: Only in counting channel
  if (message.channel.id === COUNTING_CHANNEL_ID) {
    const channelId = message.channel.id;
    const lastState = countingState.get(channelId) || { lastNum: 0, lastUser: null };

    const msgNum = parseInt(message.content.trim());
    if (!isNaN(msgNum)) {
      if (msgNum === lastState.lastNum + 1) {
        if (message.author.id === lastState.lastUser) {
          // Same user counting twice in a row: delete message
          await message.delete().catch(() => {});
          return;
        } else {
          // Different user - valid count
          await message.react("✅").catch(() => {});
          countingState.set(channelId, { lastNum: msgNum, lastUser: message.author.id });
          return;
        }
      } else if (msgNum === 1) {
        // Reset counting
        await message.react("✅").catch(() => {});
        countingState.set(channelId, { lastNum: 1, lastUser: message.author.id });
        return;
      }
      // Number out of sequence - ignore without reaction or deleting
      return;
    }
  }

  // AI chat and ticket system only inside ticket channels (names start with ticket-)
  if (!message.channel.name.startsWith("ticket-")) return;

  // AI conversation history per user
  const userId = message.author.id;
  const pastMessages = conversationHistory.get(userId)?.history || [];

  pastMessages.push({ role: "user", content: message.content });

  // Fetch AI response
  const reply = await fetchFromGroq(pastMessages);
  if (!reply) return;

  pastMessages.push({ role: "assistant", content: reply });

  conversationHistory.set(userId, {
    history: pastMessages.slice(-6),
    timestamp: Date.now(),
  });

  // Send reply in chunks if too long for Discord (max 2000 chars)
  const chunks = splitMessage(reply);
  for (const chunk of chunks) {
    await message.channel.send(chunk);
  }
});

// Groq AI chat API call
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
  } catch (err) {
    console.error("Groq API error:", err);
    return "⚠️ Sorry, I'm having trouble responding right now.";
  }
}

// Split long messages into smaller chunks (max 2000 chars)
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
