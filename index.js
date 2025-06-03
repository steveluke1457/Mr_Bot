// Improved Discord Ticket Bot with Anti-Spam, AI, Confirmations, and Auto-Close Support

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionType,
} = require("discord.js");
require("dotenv").config();
const fetch = require("node-fetch");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const HELP_CHANNEL_ID = "1374671416439472148";
const TICKET_CATEGORY_ID = "1379112243177717842";
const STAFF_ROLE_ID = "1374444076702634137";

const ticketCooldown = new Map();
const conversationHistory = new Map();
const ticketActivity = new Map();

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const helpChannel = await client.channels.fetch(HELP_CHANNEL_ID);
    const messages = await helpChannel.messages.fetch({ limit: 10 });
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
  } catch (err) {
    console.error("Error setting up help channel:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.type !== InteractionType.MessageComponent) return;

  const { customId, user, guild } = interaction;

  if (customId === "create_ticket") {
    const now = Date.now();
    const lastClick = ticketCooldown.get(user.id);
    if (lastClick && now - lastClick < 10000) {
      const userTickets = guild.channels.cache.filter((c) => c.name.includes(user.id));
      for (const channel of userTickets.values()) {
        await channel.delete().catch(() => {});
      }
      try {
        const member = await guild.members.fetch(user.id);
        await member.timeout(10 * 60 * 1000, "Spamming ticket creation");
        return interaction.reply({
          content: "⛔ You were spamming tickets and have been timed out for 10 minutes.",
          ephemeral: true,
        });
      } catch (err) {
        console.error("Timeout failed:", err);
        return interaction.reply({
          content: "❌ You are spamming tickets. Please wait before trying again.",
          ephemeral: true,
        });
      }
    }

    ticketCooldown.set(user.id, now);

    const existingTicket = guild.channels.cache.find((c) => c.name.includes(user.id));
    if (existingTicket) {
      return interaction.reply({ content: "📬 You already have an open ticket.", ephemeral: true });
    }

    const ticketChannel = await guild.channels.create({
      name: `ticket-${user.username.toLowerCase()}-${user.id}`,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
      ],
    });

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm_close").setLabel("✅ Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("cancel_close").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary)
    );

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("close_ticket").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      content: `🎫 <@${user.id}>, your ticket is now open! How can we assist you today?`,
      components: [closeRow],
    });

    ticketActivity.set(ticketChannel.id, Date.now());
    return interaction.reply({ content: "✅ Your ticket has been created.", ephemeral: true });
  }

  if (customId === "close_ticket") {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("confirm_close").setLabel("✅ Confirm").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("cancel_close").setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary)
    );
    return interaction.reply({
      content: "⚠️ Are you sure you want to close this ticket?",
      components: [confirmRow],
      ephemeral: true,
    });
  }

  if (customId === "confirm_close") {
    await interaction.channel.send("🔒 Ticket closed. Thank you!");
    return setTimeout(() => interaction.channel.delete().catch(console.error), 3000);
  }

  if (customId === "cancel_close") {
    return interaction.reply({ content: "❎ Ticket closure canceled.", ephemeral: true });
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild || !message.channel.name.startsWith("ticket-")) return;
  if (message.system || message.type !== 0) return;

  ticketActivity.set(message.channel.id, Date.now());

  const history = conversationHistory.get(message.channel.id)?.history || [];
  history.push({ role: "user", content: message.content });

  const reply = await fetchFromGroq(history);
  if (!reply) return;

  history.push({ role: "assistant", content: reply });
  conversationHistory.set(message.channel.id, {
    history: history.slice(-6),
    timestamp: Date.now(),
  });

  for (const chunk of splitMessage(reply)) {
    await message.channel.send(chunk);
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [channelId, lastActive] of ticketActivity.entries()) {
    if (now - lastActive > 12 * 60 * 60 * 1000) { // 12 hours
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        channel.send("⏳ Ticket has been inactive for 12 hours and will now be closed.")
          .then(() => setTimeout(() => channel.delete().catch(() => {}), 5000));
      }
      ticketActivity.delete(channelId);
    }
  }
}, 60 * 60 * 1000); // every hour

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

    if (!response.ok) {
      console.error("Groq API error:", await response.text());
      return null;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content.trim();
  } catch (err) {
    console.error("Fetch failed:", err);
    return "⚠️ Sorry, I am currently unable to respond.";
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
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

client.login(process.env.DISCORD_BOT_TOKEN);
