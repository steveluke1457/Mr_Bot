const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
module.exports = {
  customId: 'openTicket',
  async execute(interaction) {
    const guild = interaction.guild;
    // Find or define the Tickets category
    const category = guild.channels.cache.find(c => c.name === 'Tickets' && c.type === ChannelType.GuildCategory);
    if (!category) {
      await interaction.reply({ content: 'Tickets category not found. Please set up a category named "Tickets".', ephemeral: true });
      return;
    }
    // Find mod role
    const roleName = process.env.MOD_ROLE_NAME || 't.mod';
    const modRole = guild.roles.cache.find(r => r.name === roleName);
    if (!modRole) {
      await interaction.reply({ content: 'Mod role not found. Please check your setup.', ephemeral: true });
      return;
    }
    // Create a new ticket channel
    const ticketName = `ticket-${interaction.user.username}`;
    const ticketChannel = await guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: modRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });
    await ticketChannel.send(`${interaction.user}, thank you for opening a ticket. A moderator will be with you shortly.`);
    await interaction.reply({ content: `Created ticket ${ticketChannel}`, ephemeral: true });
  }
};
