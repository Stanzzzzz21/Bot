const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const express = require('express');
const fs = require('fs');

// ===== EXPRESS KEEP ALIVE =====
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1491381996025413764';

if (!TOKEN) {
  console.error('TOKEN missing');
  process.exit(1);
}

// ===== FILE PATHS (FIX FOR RENDER) =====
const DATA_FILE = '/tmp/data.json';
const BACKUP_FILE = '/tmp/backup.json';

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
let data = fs.existsSync(DATA_FILE)
  ? JSON.parse(fs.readFileSync(DATA_FILE))
  : {};

let backup = fs.existsSync(BACKUP_FILE)
  ? JSON.parse(fs.readFileSync(BACKUP_FILE))
  : {};

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function saveBackup(guild) {
  backup[guild.id] = guild.channels.cache.map(ch => ({
    name: ch.name,
    type: ch.type,
    parent: ch.parentId
  }));

  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
}

// ===== TRACKERS =====
let joinTracker = {};
let messageTracker = {};

// ===== SETTINGS =====
function getSettings(id) {
  if (!data[id]) data[id] = {};

  return {
    raidThreshold: data[id].raidThreshold || 5,
    spamThreshold: data[id].spamThreshold || 8,
    minAccountAge: data[id].minAccountAge || 3 * 24 * 60 * 60 * 1000,
    logChannel: data[id].logChannel || null,
    antiraid: data[id].antiraid ?? true
  };
}

// ===== LOG =====
function log(guild, msg) {
  const settings = getSettings(guild.id);
  if (!settings.logChannel) return;

  const ch = guild.channels.cache.get(settings.logChannel);
  if (!ch) return;

  ch.send({
    embeds: [new EmbedBuilder().setTitle("🛡️ Log").setDescription(msg).setColor("Green")]
  }).catch(() => {});
}

// ===== TRACK =====
function trackJoins(id) {
  const now = Date.now();
  if (!joinTracker[id]) joinTracker[id] = [];

  joinTracker[id].push(now);
  joinTracker[id] = joinTracker[id].filter(t => now - t < 10000);

  return joinTracker[id].length;
}

function trackMessages(userId, guildId) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();

  if (!messageTracker[key]) messageTracker[key] = [];

  messageTracker[key].push(now);
  messageTracker[key] = messageTracker[key].filter(t => now - t < 2000);

  return messageTracker[key].length;
}

// ===== LOCK =====
async function lockServer(guild) {
  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false
    }).catch(() => {});
  });

  log(guild, '🚨 RAID → LOCKED');
}

// ===== RESTORE =====
async function restoreGuild(guild) {
  const data = backup[guild.id];
  if (!data) return;

  for (const ch of data) {
    await guild.channels.create({
      name: ch.name,
      type: ChannelType.GuildText,
      parent: ch.parent
    }).catch(() => {});
  }
}

// ===== ANTI NUKE =====
client.on('channelDelete', async channel => {
  if (!channel.guild) return;

  saveBackup(channel.guild);
});

// ===== EVENTS =====
client.on('guildMemberAdd', async member => {
  const settings = getSettings(member.guild.id);

  if (!settings.antiraid) return;

  if (trackJoins(member.guild.id) >= settings.raidThreshold) {
    await lockServer(member.guild);
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const settings = getSettings(message.guild.id);

  if (trackMessages(message.author.id, message.guild.id) >= settings.spamThreshold) {
    try {
      await message.delete();
      await message.member.timeout(60000);
    } catch {}
  }
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Dashboard'),
  new SlashCommandBuilder().setName('setup').setDescription('Setup wizard')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commands registered");
  } catch (err) {
    console.error("Command error:", err);
  }
})();

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'dashboard') {
      return interaction.reply({ content: 'Dashboard', ephemeral: true });
    }

    if (interaction.commandName === 'setup') {
      return interaction.reply({ content: 'Setup coming...', ephemeral: true });
    }
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
