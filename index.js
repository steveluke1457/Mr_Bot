const { 
  Client, GatewayIntentBits, Partials, ChannelType, PermissionsBitField, 
  ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require("discord.js");
require("dotenv").config();
const fetch = require("node-fetch");

// Create Discord client with proper intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.MessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// === IDs - Replace these with your actual IDs ===
const HELP_CHANNEL_ID = "1374671416439472148";     // Help channel where ticket button is posted
const TICKET_CATEGORY_ID = "1379112243177717842";  // Category under which tickets are created
const STAFF_ROLE_ID = "1374444076702634137";       // Role allowed to see tickets
const COUNTING_CHANNEL_ID = "1375514672433991680"; // Counting channel

// Cooldown to prevent ticket spam
const ticketCooldown = new Map();

// Conversation history per user for AI replies in tickets
const conversationHistory = new Map();

// Counting state: track last number and user per channel (just one channel here)
const countingState = new Map();

// When bot is ready
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const helpChannel = await client.channels.fetch(HELP_CHANNEL_ID);

    // Check if the ticket button message already exists to avoid duplicates
    const fetchedMessages = await helpChannel.messages.fetch({ limit: 10 });
    const buttonMessageExists = fetchedMessages.some(msg =>
      msg.components.length > 0 && 
      msg.components[0].components.some(c => c.customId === "create_ticket")
    );

    if (!buttonMessageExists) {
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
      console.log("🎫 Ticket button posted in help channel.");
    }
  } catch (error) {
    console.error("Error fetching help channel or sending button:", error);
  }
});

// Button interactions handler
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const { customId, user, guild } = interaction;

  // Create ticket button pressed
  if (customId === "create_ticket") {
    const now = Date.now();
    const lastClick = ticketCooldown.get(user.id);

    // Prevent spam: only one ticket every 10 seconds
    if (lastClick && now - lastClick < 10_000) {
      // Delete any existing tickets from user and timeout for 10 minutes
      const userTickets = guild.channels.cache.filter(c =>
        c.name === `ticket-${user.username.toLowerCase()}`
      );
      userTickets.forEach(channel => channel.delete().catch(() => {}));

      try {
        const member = await guild.members.fetch(user.id);
        await member.timeout(10 * 60 * 1000, "Spamming ticket system");

        await interaction.reply({
          content: "⛔ You were spamming tickets and have been timed out for 10 minutes.",
          ephemeral: true,
        });
      } catch {
        await interaction.reply({
          content: "❌ You are spamming tickets. Please wait before trying again.",
          ephemeral: true,
        });
      }
      console.log(`[⚠️] ${user.tag} timed out for ticket spam.`);
      return;
    }

    ticketCooldown.set(user.id, now);

    // Check if user already has an open ticket
    const existingTicket = guild.channels.cache.find(
      c => c.name === `ticket-${user.username.toLowerCase()}`
    );
    if (existingTicket) {
      return interaction.reply({
        content: "📬 You already have an open ticket.",
        ephemeral: true,
      });
    }

    // Create new ticket channel
    try {
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

      // Send close ticket button
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
    } catch (error) {
      console.error("Error creating ticket channel:", error);
      await interaction.reply({
        content: "❌ Failed to create ticket channel. Please contact a staff member.",
        ephemeral: true,
      });
    }
  }

  // Close ticket button pressed
  if (customId === "close_ticket") {
    const channel = interaction.channel;
    await interaction.reply("🕐 Closing this ticket in 5 seconds...");
    setTimeout(() => {
      channel.delete().catch(console.error);
    }, 5000);
  }
});

// Message handler for counting and AI chat in tickets
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  // === Counting channel logic ===
  if (message.channel.id === COUNTING_CHANNEL_ID) {
    const channelId = message.channel.id;
    const lastState = countingState.get(channelId) || { lastNum: 0, lastUser: null };

    const msgNum = parseInt(message.content.trim());
    if (!isNaN(msgNum)) {
      if (msgNum === lastState.lastNum + 1) {
        if (message.author.id === lastState.lastUser) {
          // Same user trying to count twice in a row: delete message
          await message.delete().catch(() => {});
          return;
        } else {
          // Valid count, add reaction and update state
          await message.react("✅").catch(() => {});
          countingState.set(channelId, { lastNum: msgNum, lastUser: message.author.id });
          return;
        }
      } else if (msgNum === 1) {
        // Reset count to 1 (allowed anytime)
        await message.react("✅").catch(() => {});
        countingState.set(channelId, { lastNum: 1, lastUser: message.author.id });
        return;
      }
      // Invalid count number, no reaction, no deletion
      return;
    }
  }

  // === AI chat inside ticket channels only ===
  if (!message.channel.name.startsWith("ticket-")) return;

  const userId = message.author.id;
  let pastMessages = conversationHistory.get(userId)?.history || [];

  // Add user message to history
  pastMessages.push({ role: "user", content: message.content });

  // Fetch AI reply
  const reply = await fetchFromGroq(pastMessages);
  if (!reply) return;

  // Add AI reply to history (limit last 6 messages)
  pastMessages.push({ role: "assistant", content: reply });
  conversationHistory.set(userId, {
    history: pastMessages.slice(-6),
    timestamp: Date.now(),
  });

  // Send AI reply (split into chunks if too long)
  const chunks = splitMessage(reply);
  for (const chunk of chunks) {
    await message.channel.send(chunk);
  }
});

// Fetch AI response from Groq API
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

// Helper: split long messages to Discord message limit (2000 chars)
function splitMessage(text, maxLength = 2000) {
  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current.length ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// Login bot
client.login(process.env.DISCORD_BOT_TOKEN);
