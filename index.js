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

// ===== EXPRESS (Render fix) =====
app.get('/', (req, res) => res.send('Bot is running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

// ===== TOKEN =====
const TOKEN const TOKEN = process.env.TOKEN;
client.login(TOKEN);
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

// ===== LOG SYSTEM =====
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

// ===== SLASH COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setlogs')
    .setDescription('Set log channel')
    .addChannelOption(o => o.setName('channel').setDescription('Channel').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Commands registered');
  } catch (err) {
    console.error('Command deploy error:', err);
  }
})();

// ===== SETUP DROPDOWN =====
client.on('guildCreate', async guild => {
  const channel = guild.systemChannel;
  if (!channel) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId('setup')
    .setPlaceholder('Setup your bot')
    .addOptions([
      { label: 'Spam Limit: 5', value: 'spam_5' },
      { label: 'Spam Limit: 10', value: 'spam_10' },
      { label: 'Logs ON', value: 'logs_on' },
      { label: 'Logs OFF', value: 'logs_off' }
    ]);

  channel.send({
    content: '🛡️ Setup your bot:',
    components: [new ActionRowBuilder().addComponents(menu)]
  }).catch(() => {});
});

// ===== RAID =====
let raidMode = false;
let joins = [];

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  if (interaction.isStringSelectMenu()) {
    const id = interaction.guild.id;
    const value = interaction.values[0];

    if (!data[id]) data[id] = {};

    if (value === 'spam_5') data[id].spam = 5;
    if (value === 'spam_10') data[id].spam = 10;

    if (value === 'logs_on') data[id].logs = true;
    if (value === 'logs_off') data[id].logs = false;

    saveData();

    return interaction.reply({ content: `Saved: ${value}`, ephemeral: true });
  }

  if (interaction.isChatInputCommand()) {
    const id = interaction.guild.id;

    if (!hasPermission(interaction.member, id)) {
      return interaction.reply({ content: '❌ No permission', ephemeral: true });
    }

    if (interaction.commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) return interaction.reply({ content: 'User not found', ephemeral: true });

      await member.kick().catch(() => {});
      sendLog(interaction.guild, `${user.tag} kicked`);

      return interaction.reply(`Kicked ${user.tag}`);
    }

    if (interaction.commandName === 'ban') {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) return interaction.reply({ content: 'User not found', ephemeral: true });

      await member.ban().catch(() => {});
      sendLog(interaction.guild, `${user.tag} banned`);

      return interaction.reply(`Banned ${user.tag}`);
    }

    if (interaction.commandName === 'setlogs') {
      const channel = interaction.options.getChannel('channel');

      if (!data[id]) data[id] = {};
      data[id].logChannel = channel.id;

      saveData();

      return interaction.reply(`Log channel set`);
    }
  }
});

// ===== LOGIN =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
