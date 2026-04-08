const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} = require('discord.js');

const express = require('express');
const fs = require('fs');

const app = express();

// ===== EXPRESS =====
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// ===== TOKEN =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1491381996025413764';

if (!TOKEN) {
  console.error('TOKEN is missing!');
  process.exit(1);
}

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== DATA =====
let data = fs.existsSync('./data.json')
  ? JSON.parse(fs.readFileSync('./data.json'))
  : {};

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// ===== HELPERS =====
function isOwner(interaction) {
  return interaction.guild.ownerId === interaction.user.id;
}

function sendLog(guild, message) {
  const id = guild.id;
  if (!data[id]?.logs) return;

  const channel = guild.channels.cache.get(data[id].logChannel);
  if (!channel) return;

  channel.send(`📊 ${message}`).catch(() => {});
}

// ===== PERMISSIONS =====
function hasPermission(member, guildId) {
  const role = data[guildId]?.role;

  if (role === 'all') return true;
  if (role === 'admin') return member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (role === 'mod') return member.permissions.has(PermissionsBitField.Flags.ManageMessages);

  return false;
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('kick').setDescription('Kick user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('ban').setDescription('Ban user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('setlogs').setDescription('Set log channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true)),

  new SlashCommandBuilder().setName('dashboard').setDescription('Setup dashboard')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Commands registered');
})();

// ===== BOT JOIN SERVER =====
client.on('guildCreate', guild => {
  if (!guild.systemChannel) return;

  guild.systemChannel.send('🛡️ Bot installed! Use /dashboard to configure me.');
});

// ===== MEMBER JOIN WELCOME =====
client.on('guildMemberAdd', member => {
  const id = member.guild.id;

  if (!data[id]?.welcome) return;
  if (!data[id]?.welcomeChannel) return;

  const channel = member.guild.channels.cache.get(data[id].welcomeChannel);
  if (!channel) return;

  channel.send(`👋 Welcome ${member.user.tag}!`);
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  const id = interaction.guild?.id;
  if (!id) return;

  // DASHBOARD
  if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: '❌ Only the owner can use this', ephemeral: true });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('dashboard')
      .setPlaceholder('Configure bot')
      .addOptions([
        { label: 'Welcome ON', value: 'welcome_on' },
        { label: 'Welcome OFF', value: 'welcome_off' },
        { label: 'Set Welcome Channel', value: 'set_welcome_channel' }
      ]);

    return interaction.reply({
      content: '⚙️ Setup Dashboard',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  // MENU HANDLER
  if (interaction.isStringSelectMenu()) {

    if (!isOwner(interaction)) {
      return interaction.reply({ content: '❌ Only owner can configure this', ephemeral: true });
    }

    const value = interaction.values[0];

    if (!data[id]) data[id] = {};

    if (value === 'welcome_on') data[id].welcome = true;
    if (value === 'welcome_off') data[id].welcome = false;

    if (value === 'set_welcome_channel') {
      data[id].waitingForChannel = true;
      saveData();

      return interaction.reply({
        content: '📩 Send channel ID in chat',
        ephemeral: true
      });
    }

    saveData();

    return interaction.reply({ content: `Saved: ${value}`, ephemeral: true });
  }

  // COMMANDS
  if (interaction.isChatInputCommand()) {

    if (!hasPermission(interaction.member, id)) {
      return interaction.reply({ content: '❌ No permission', ephemeral: true });
    }

    if (interaction.commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id);

      await member.kick();
      sendLog(interaction.guild, `${user.tag} kicked`);

      return interaction.reply(`Kicked ${user.tag}`);
    }

    if (interaction.commandName === 'ban') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id);

      await member.ban();
      sendLog(interaction.guild, `${user.tag} banned`);

      return interaction.reply(`Banned ${user.tag}`);
    }

    if (interaction.commandName === 'setlogs') {
      const channel = interaction.options.getChannel('channel');

      if (!data[id]) data[id] = {};
      data[id].logChannel = channel.id;

      saveData();

      return interaction.reply('Log channel set');
    }
  }
});

// ===== CHANNEL INPUT =====
client.on('messageCreate', message => {
  if (message.author.bot) return;

  const id = message.guild?.id;
  if (!id) return;

  if (data[id]?.waitingForChannel) {
    const channel = message.guild.channels.cache.get(message.content);

    if (!channel) return message.reply('❌ Invalid channel ID');

    data[id].welcomeChannel = channel.id;
    data[id].waitingForChannel = false;

    saveData();

    message.reply('✅ Welcome channel set!');
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== LOGIN =====
client.login(TOKEN);
