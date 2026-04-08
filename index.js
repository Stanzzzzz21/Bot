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

let backup = fs.existsSync('./backup.json')
  ? JSON.parse(fs.readFileSync('./backup.json'))
  : {};

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

function saveBackup(guild) {
  backup[guild.id] = guild.channels.cache.map(ch => ({
    name: ch.name,
    type: ch.type,
    parent: ch.parentId
  }));

  fs.writeFileSync('./backup.json', JSON.stringify(backup, null, 2));
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

// ===== TRACK JOIN =====
function trackJoins(id) {
  const now = Date.now();
  if (!joinTracker[id]) joinTracker[id] = [];

  joinTracker[id].push(now);
  joinTracker[id] = joinTracker[id].filter(t => now - t < 10000);

  return joinTracker[id].length;
}

// ===== TRACK MESSAGES =====
function trackMessages(userId, guildId) {
  const key = `${guildId}-${userId}`;
  const now = Date.now();

  if (!messageTracker[key]) messageTracker[key] = [];

  messageTracker[key].push(now);
  messageTracker[key] = messageTracker[key].filter(t => now - t < 2000);

  return messageTracker[key].length;
}

// ===== LOCKDOWN =====
async function lockServer(guild) {
  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false
    }).catch(() => {});
  });

  log(guild, '🚨 RAID → LOCKED');

  setTimeout(() => {
    guild.channels.cache.forEach(ch => {
      ch.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: null
      }).catch(() => {});
    });

    log(guild, '🔓 UNLOCKED');
  }, 60000);
}

// ===== RESTORE =====
async function restoreGuild(guild) {
  const data = backup[guild.id];
  if (!data) return;

  for (const ch of data) {
    await guild.channels.create({
      name: ch.name,
      type: ch.type,
      parent: ch.parent
    }).catch(() => {});
  }
}

// ===== ANTI-NUKE =====
const auditTracker = {};

client.on('channelDelete', async channel => {
  if (!channel.guild) return;

  saveBackup(channel.guild);

  const logs = await channel.guild.fetchAuditLogs({ limit: 1 });
  const entry = logs.entries.first();

  if (!entry) return;

  const user = entry.executor.id;

  auditTracker[user] = (auditTracker[user] || 0) + 1;

  if (auditTracker[user] > 3) {
    await lockServer(channel.guild);
  }
});

// ===== EVENTS =====
client.on('guildMemberAdd', async member => {
  const id = member.guild.id;
  const settings = getSettings(id);

  if (!settings.antiraid) return;

  if (trackJoins(id) >= settings.raidThreshold) {
    await lockServer(member.guild);
  }

  if (Date.now() - member.user.createdTimestamp < settings.minAccountAge) {
    try {
      await member.timeout(60000);
      log(member.guild, `👶 New account: ${member.user.tag}`);
    } catch {}
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const settings = getSettings(message.guild.id);

  if (trackMessages(message.author.id, message.guild.id) >= settings.spamThreshold) {
    try {
      await message.delete();
      await message.member.timeout(60000);
      log(message.guild, `🚫 Spam: ${message.author.tag}`);
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
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
})();

// ===== DASHBOARD =====
client.on('interactionCreate', async interaction => {

  // ===== COMMANDS =====
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'dashboard') {

      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Owner only', ephemeral: true });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('menu')
        .setPlaceholder('⚙️ Select')
        .addOptions([
          { label: 'Enable Anti-Raid', value: 'on' },
          { label: 'Disable Anti-Raid', value: 'off' },
          { label: 'Create Logs Channel', value: 'logs' },
          { label: 'Backup', value: 'backup' },
          { label: 'Restore', value: 'restore' }
        ]);

      return interaction.reply({
        content: '⚙️ Dashboard',
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    if (interaction.commandName === 'setup') {

      const embed = new EmbedBuilder()
        .setTitle('🛡️ Setup')
        .setDescription('Enable Anti-Raid?');

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('setup_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('setup_no').setLabel('No').setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
    }
  }

  // ===== MENU =====
  if (interaction.isStringSelectMenu()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    const value = interaction.values[0];

    if (value === 'on') data[id].antiraid = true;
    if (value === 'off') data[id].antiraid = false;

    if (value === 'logs') {
      const ch = await interaction.guild.channels.create({
        name: 'bot-logs',
        type: ChannelType.GuildText
      });

      data[id].logChannel = ch.id;
    }

    if (value === 'backup') saveBackup(interaction.guild);

    if (value === 'restore') await restoreGuild(interaction.guild);

    saveData();

    return interaction.reply({ content: '✅ Updated', ephemeral: true });
  }

  // ===== SETUP BUTTONS =====
  if (interaction.isButton()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    if (interaction.customId === 'setup_yes') {
      data[id].antiraid = true;

      const embed = new EmbedBuilder()
        .setDescription('Send spam limit number in chat');

      await interaction.reply({ embeds: [embed], ephemeral: true });

      const filter = m => m.author.id === interaction.user.id;

      const collector = interaction.channel.createMessageCollector({ filter, max: 1 });

      collector.on('collect', msg => {
        const num = parseInt(msg.content);

        if (!isNaN(num)) {
          data[id].spamThreshold = num;
          saveData();
          msg.reply('✅ Setup complete');
        }
      });
    }

    if (interaction.customId === 'setup_no') {
      data[id].antiraid = false;
      saveData();
      return interaction.reply({ content: '❌ Disabled', ephemeral: true });
    }
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
