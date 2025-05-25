const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the current ticket channel'),
  async execute(interaction) {
    const channel = interaction.channel;
    if (!channel.name.startsWith('ticket-')) {
      return interaction.reply({ content: 'This is not a ticket channel.', ephemeral: true });
    }

    await interaction.reply('✅ Ticket will be closed in 3 seconds...');
    setTimeout(() => {
      channel.delete().catch(console.error);
    }, 3000);
  },
};
