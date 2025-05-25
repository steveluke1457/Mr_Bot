require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, EmbedBuilder, SlashCommandBuilder, Collection } = require('discord.js');
const Groq = require('groq-sdk');

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: []
});

// Load commands dynamically from commands/ folder
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const cmd = require(`./commands/${file}`);
  client.commands.set(cmd.data.name, cmd);
}

// Load button components from components/ folder
client.buttons = new Collection();
const buttonsPath = path.join(__dirname, 'components');
const buttonFiles = fs.readdirSync(buttonsPath).filter(f => f.endsWith('.js'));
for (const file of buttonFiles) {
  const btn = require(`./components/${file}`);
  client.buttons.set(btn.customId, btn);
}

// Initialize Groq client for AI
const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Event: Bot is ready
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Register slash commands for this guild (server) only, for instant availability
  const guildId = process.env.GUILD_ID;
  const commandsData = [];
  client.commands.forEach(cmd => commandsData.push(cmd.data.toJSON()));
  await client.application.commands.set(commandsData, guildId);
  console.log('Slash commands registered.');

  // Start the web dashboard server
  startWebDashboard(client);
});

// Event: Interaction (slash command or button click)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    // Slash command
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client, groqClient);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: 'There was an error while executing this command.', ephemeral: true });
    }
  } else if (interaction.isButton()) {
    // Button component
    const button = client.buttons.get(interaction.customId);
    if (button) {
      try {
        await button.execute(interaction, client, groqClient);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: 'Error processing button.', ephemeral: true });
      }
    }
  }
});

// Event: Message created (for AI chat and moderation)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return; // ignore bot messages

  // Auto-moderation: basic word filter
  const banned = process.env.BANNED_WORDS || '';
  const bannedList = banned.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
  const contentLower = message.content.toLowerCase();
  for (const word of bannedList) {
    if (word && contentLower.includes(word)) {
      await message.delete();
      await message.channel.send(`${message.author}, that language is not allowed here.`);
      return;
    }
  }

  // Auto-moderation: spam detection (very basic)
  // If user sends >5 messages in 10 seconds, warn once
  client.spamData = client.spamData || new Map();
  const now = Date.now();
  const userData = client.spamData.get(message.author.id) || { count: 0, last: 0 };
  if (now - userData.last < 10000) {
    userData.count++;
  } else {
    userData.count = 1;
  }
  userData.last = now;
  client.spamData.set(message.author.id, userData);
  if (userData.count > 5) {
    await message.channel.send(`${message.author}, please slow down.`);
    client.spamData.set(message.author.id, { count: 0, last: now });
    return;
  }

  // AI chat: if in #talk-with-ai or a ticket channel, reply via Groq Llama-4
  const channelName = message.channel.name;
  const inTicketCategory = message.channel.parent?.name === 'Tickets';
  if (channelName === 'talk-with-ai' || (inTicketCategory && channelName !== 'ticket')) {
    // Prepare a system prompt to act like a helpful moderator/assistant
    const systemPrompt = "You are a friendly moderator assisting the user. Provide helpful, polite, and human-like responses.";
    try {
      await message.channel.sendTyping(); // indicate bot is thinking
      const response = await groqClient.chat.completions.create({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message.content }
        ]
      });
      const reply = response.choices[0].message.content;
      if (reply) {
        await message.reply(reply);
      }
    } catch (err) {
      console.error('AI chat error:', err);
      await message.reply('Sorry, I am having trouble processing that.');
    }
  }
});

// Event: Member gets roles updated (for moderator onboarding)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const roleName = process.env.MOD_ROLE_NAME || 't.mod';
  const role = newMember.guild.roles.cache.find(r => r.name === roleName);
  if (!role) return;
  // Check if the mod role was just added
  const hadRole = oldMember.roles.cache.has(role.id);
  const hasRole = newMember.roles.cache.has(role.id);
  if (!hadRole && hasRole) {
    const welcomeChannel = newMember.guild.channels.cache.get(process.env.MOD_WELCOME_CHANNEL_ID);
    if (welcomeChannel) {
      const embed = new EmbedBuilder()
        .setTitle('👋 New Moderator Onboarded')
        .setDescription(`${newMember.user} has been given the ${roleName} role.`)
        .addFields(
          { name: 'Welcome!', value: `Welcome to the moderator team, ${newMember.user.username}!` },
          { name: 'Guidelines', value: 'Please review the server rules and mod guidelines. Use `/close` to close tickets, and help maintain a friendly environment.' }
        )
        .setTimestamp();
      await welcomeChannel.send({ embeds: [embed] });
    }
  }
});

// Start Express web dashboard (called from ready)
function startWebDashboard(discordClient) {
  const app = express();
  const SESSION_SECRET = process.env.SESSION_SECRET || 'sessionsecret';
  const ADMIN_USER = process.env.ADMIN_USER;
  const ADMIN_PASS = process.env.ADMIN_PASS;

  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true
  }));

  // Middleware to protect dashboard routes
  function ensureAuth(req, res, next) {
    if (req.session && req.session.loggedIn) return next();
    res.redirect('/');
  }

  // Login page
  app.get('/', (req, res) => {
    if (req.session && req.session.loggedIn) return res.redirect('/tickets');
    res.send(`
      <h2>Totoro-Hacker Dashboard Login</h2>
      <form method="post" action="/login">
        <label>Username: <input name="username"></label><br>
        <label>Password: <input type="password" name="password"></label><br>
        <button type="submit">Login</button>
      </form>
    `);
  });

  // Handle login form
  app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      req.session.loggedIn = true;
      res.redirect('/tickets');
    } else {
      res.send('Invalid credentials. <a href="/">Try again</a>.');
    }
  });

  // Logout
  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
  });

  // View open tickets
  app.get('/tickets', ensureAuth, (req, res) => {
    const guild = discordClient.guilds.cache.get(process.env.GUILD_ID);
    let ticketsHtml = '<h2>Open Tickets</h2>';
    if (guild) {
      const category = guild.channels.cache.find(ch => ch.name === 'Tickets' && ch.type === ChannelType.GuildCategory);
      if (category) {
        for (const [id, channel] of category.children) {
          if (channel.name.startsWith('ticket-')) {
            ticketsHtml += `<p><strong>${channel.name}</strong> (ID: ${channel.id})</p>`;
          }
        }
      } else {
        ticketsHtml += '<p>No Tickets category found in server.</p>';
      }
    } else {
      ticketsHtml += '<p>Guild not found.</p>';
    }
    ticketsHtml += '<p><a href="/status">Server Status</a> | <a href="/roles">Mod Roles</a> | <a href="/logout">Logout</a></p>';
    res.send(ticketsHtml);
  });

  // View status
  app.get('/status', ensureAuth, (req, res) => {
    const uptimeSeconds = Math.floor(process.uptime());
    res.send(`<h2>Bot Status</h2><p>Uptime: ${uptimeSeconds} seconds</p>
      <p><a href="/tickets">Tickets</a> | <a href="/roles">Mod Roles</a> | <a href="/logout">Logout</a></p>`);
  });

  // View/Manage mod roles
  app.get('/roles', ensureAuth, (req, res) => {
    const guild = discordClient.guilds.cache.get(process.env.GUILD_ID);
    let rolesHtml = '<h2>Moderator Roles</h2>';
    if (guild) {
      // List roles that include 'mod' in name
      const modRoles = guild.roles.cache.filter(r => r.name.toLowerCase().includes('mod'));
      if (modRoles.size) {
        rolesHtml += '<ul>';
        modRoles.forEach(r => { rolesHtml += `<li>${r.name} (ID: ${r.id})</li>`; });
        rolesHtml += '</ul>';
      } else {
        rolesHtml += '<p>No mod roles found.</p>';
      }
    } else {
      rolesHtml += '<p>Guild not found.</p>';
    }
    rolesHtml += '<p>To change mod roles, edit the Discord server roles or update the code.</p>';
    rolesHtml += '<p><a href="/tickets">Tickets</a> | <a href="/status">Server Status</a> | <a href="/logout">Logout</a></p>';
    res.send(rolesHtml);
  });

  // Web server listen
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Dashboard listening on port ${PORT}`);
  });
}

// Log in to Discord (starts the bot)
client.login(process.env.DISCORD_TOKEN);
