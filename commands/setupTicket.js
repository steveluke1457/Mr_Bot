const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('setupticket')
    .setDescription('Initialize the ticket button in this channel. (Mods only)'),
  async execute(interaction) {
    // Check if user has moderator role
    const roleName = process.env.MOD_ROLE_NAME || 't.mod';
    const member = interaction.member;
    const hasRole = member.roles.cache.some(r => r.name === roleName);
    if (!hasRole) {
      return interaction.reply({ content: 'Only moderators can run this command.', ephemeral: true });
    }

    // Create a button for opening tickets
    const button = new ButtonBuilder()
      .setCustomId('openTicket')
      .setLabel('Open Ticket')
      .setStyle(ButtonStyle.Success);
    const row = new ActionRowBuilder().addComponents(button);

    // Send the ticket embed with button to this channel
    await interaction.channel.send({
      content: 'If you need help, click the button below to open a ticket:',
      components: [row]
    });
    await interaction.reply({ content: 'Ticket system initialized!', ephemeral: true });
  },
};
