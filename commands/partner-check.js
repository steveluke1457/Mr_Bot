const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  data: new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Run partnership screening on a server invite')
    .addStringOption(opt => opt
      .setName('invite')
      .setDescription('Discord server invite link or code')
      .setRequired(true)),
  async execute(interaction, client) {
    // Check mod role
    const roleName = process.env.MOD_ROLE_NAME || 't.mod';
    const member = interaction.member;
    const hasRole = member.roles.cache.some(r => r.name === roleName);
    if (!hasRole) {
      return interaction.reply({ content: 'Only moderators can use this command.', ephemeral: true });
    }

    const inviteInput = interaction.options.getString('invite');
    const code = inviteInput.split('/').pop();
    try {
      const invite = await client.fetchInvite(code, { withCounts: true });
      const guild = invite.guild;
      // Simple rule checks
      let passed = true;
      let reason = '';
      if (invite.approximateMemberCount < 50) {
        passed = false;
        reason += 'Member count too low (<50). ';
      }
      if (guild.nsfwLevel > 0) {
        passed = false;
        reason += 'NSFW channels enabled. ';
      }
      // Compile result message
      const result = `**Partner Check for ${guild.name}** (ID: ${guild.id}):\n` +
                     `Members: ${invite.approximateMemberCount}.\n` +
                     (passed ? '**Passed** all checks.' : `**Failed**: ${reason}`);
      // Send to partnership review channel (in main guild)
      const reviewChannel = interaction.guild.channels.cache.get(process.env.PARTNERSHIP_CHANNEL_ID);
      if (reviewChannel) {
        await reviewChannel.send(result);
      }
      await interaction.reply({ content: 'Partnership screening complete (see review channel).', ephemeral: true });
    } catch (err) {
      console.error('Invite fetch error:', err);
      await interaction.reply({ content: 'Invalid invite link or bot cannot fetch data.', ephemeral: true });
    }
  },
};
