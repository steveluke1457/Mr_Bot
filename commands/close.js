const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close this ticket channel (Mods only)'),
  async execute(interaction) {
    // Only allow in a ticket channel
    if (!interaction.channel.name.startsWith('ticket-')) {
      return interaction.reply({ content: 'This command can only be used in a ticket channel.', ephemeral: true });
    }
    // Check mod role
    const roleName = process.env.MOD_ROLE_NAME || 't.mod';
    const member = interaction.member;
    const hasRole = member.roles.cache.some(r => r.name === roleName);
    if (!hasRole) {
      return interaction.reply({ content: 'Only moderators can close tickets.', ephemeral: true });
    }
    // Delete the channel
    await interaction.reply({ content: 'Closing ticket...', ephemeral: true });
    await interaction.channel.delete();
  },
};
