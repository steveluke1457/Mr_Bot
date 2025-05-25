const { Client, GatewayIntentBits, Partials, Events, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Send the button in the help channel
  const channel = client.channels.cache.get(process.env.HELP_CHANNEL_ID);
  if (channel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_ticket')
        .setLabel('🎟 Open Ticket')
        .setStyle(ButtonStyle.Primary)
    );
    channel.send({ content: 'Need help? Click below:', components: [row] });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_ticket') {
    const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.id}`);
    if (existing) {
      return interaction.reply({ content: `You already have a ticket: ${existing}`, ephemeral: true });
    }

    const modRole = interaction.guild.roles.cache.find(r => r.name.toLowerCase() === 'mod');

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.id}`,
      type: 0,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
        {
          id: modRole?.id || interaction.guild.ownerId,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages],
        }
      ]
    });

    channel.send(`Hello <@${interaction.user.id}>! A moderator will assist you shortly.`);
    interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
  }
});

client.login(process.env.TOKEN);
