const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
  ChannelType
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

// ===== RAID TRACKER =====
let joinTracker = {};

function checkRaid(guildId) {
  if (!joinTracker[guildId]) joinTracker[guildId] = [];

  const now = Date.now();
  joinTracker[guildId].push(now);

  // keep last 10 seconds only
  joinTracker[guildId] = joinTracker[guildId].filter(t => now - t < 10000);

  return joinTracker[guildId].length;
}

// ===== HELPERS =====
function isOwner(interaction) {
  return interaction.guild.ownerId === interaction.user.id;
}

function sendLog(guild, message) {
  const id = guild.id;
  if (!data[id]?.logChannel) return;

  const channel = guild.channels.cache.get(data[id].logChannel);
  if (!channel) return;

  channel.send(`📊 ${message}`).catch(() => {});
}

// ===== PERMISSIONS =====
function hasPermission(member, guildId, command) {
  const perms = data[guildId]?.permissions || {};

  if (command === 'ban' || command === 'kick') return true;

  const allowedRoles = perms[command] || [];
  return allowedRoles.some(roleId => member.roles.cache.has(roleId));
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('kick').setDescription('Kick user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('ban').setDescription('Ban user')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)),

  new SlashCommandBuilder().setName('dashboard').setDescription('Setup dashboard')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Commands registered');
})();

// ===== BOT JOIN =====
client.on('guildCreate', guild => {
  if (!guild.systemChannel) return;
  guild.systemChannel.send('🛡️ Bot installed! Use /dashboard to configure me.');
});

// ===== JOIN + ANTI RAID =====
client.on('guildMemberAdd', async member => {
  const id = member.guild.id;

  if (!data[id]) data[id] = {};

  // RAID CHECK
  if (data[id].antiraid) {
    const count = checkRaid(id);
    const threshold = data[id].raidThreshold || 5;

    if (count >= threshold) {

      // LOCK SERVER
      member.guild.channels.cache.forEach(ch => {
        ch.permissionOverwrites.edit(member.guild.roles.everyone, {
          SendMessages: false
        }).catch(() => {});
      });

      sendLog(member.guild, '🚨 RAID DETECTED — Server locked');

      return;
    }
  }

  // WELCOME
  if (data[id]?.welcome && data[id]?.welcomeChannel) {
    const channel = member.guild.channels.cache.get(data[id].welcomeChannel);
    if (channel) channel.send(`👋 Welcome ${member.user.tag}`);
  }
});

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  const id = interaction.guild?.id;
  if (!id) return;

  // ===== DASHBOARD =====
  if (interaction.isChatInputCommand() && interaction.commandName === 'dashboard') {
    if (!isOwner(interaction)) {
      return interaction.reply({ content: '❌ Only owner', ephemeral: true });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('dashboard')
      .setPlaceholder('⚙️ Setup')
      .addOptions([
        { label: 'Welcome ON', value: 'welcome_on' },
        { label: 'Welcome OFF', value: 'welcome_off' },
        { label: 'Enable Anti-Raid', value: 'raid_on' },
        { label: 'Disable Anti-Raid', value: 'raid_off' },
        { label: 'Create Logs Channel', value: 'create_logs' },
        { label: 'Set Raid Threshold', value: 'set_threshold' }
      ]);

    return interaction.reply({
      content: '⚙️ **Setup Panel**',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }

  // ===== MENU =====
  if (interaction.isStringSelectMenu()) {

    if (!isOwner(interaction)) {
      return interaction.reply({ content: '❌ Owner only', ephemeral: true });
    }

    const value = interaction.values[0];

    if (!data[id]) data[id] = {};
    if (!data[id].permissions) data[id].permissions = {};

    if (value === 'welcome_on') data[id].welcome = true;
    if (value === 'welcome_off') data[id].welcome = false;

    if (value === 'raid_on') data[id].antiraid = true;
    if (value === 'raid_off') data[id].antiraid = false;

    if (value === 'create_logs') {
      const channel = await interaction.guild.channels.create({
        name: 'bot-logs',
        type: ChannelType.GuildText
      });

      data[id].logChannel = channel.id;
      data[id].logs = true;
    }

    if (value === 'set_threshold') {
      data[id].waitingThreshold = true;

      return interaction.reply({
        content: '📩 Send raid threshold number',
        ephemeral: true
      });
    }

    saveData();

    return interaction.reply({ content: '✅ Updated', ephemeral: true });
  }

  // ===== COMMANDS =====
  if (interaction.isChatInputCommand()) {

    if (!hasPermission(interaction.member, id, interaction.commandName)) {
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
  }
});

// ===== THRESHOLD INPUT =====
client.on('messageCreate', message => {
  if (message.author.bot) return;

  const id = message.guild?.id;
  if (!id) return;

  if (data[id]?.waitingThreshold) {
    const num = parseInt(message.content);

    if (isNaN(num)) return message.reply('❌ Number only');

    data[id].raidThreshold = num;
    data[id].waitingThreshold = false;

    saveData();

    message.reply(`✅ Threshold set to ${num}`);
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== LOGIN =====
client.login(TOKEN);
