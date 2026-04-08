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
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const express = require('express');
const fs = require('fs');

// ===== EXPRESS =====
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

// ===== FIX: RENDER SAFE FILE PATHS =====
const DATA_FILE = process.env.NODE_ENV === 'production' ? '/tmp/data.json' : './data.json';
const BACKUP_FILE = process.env.NODE_ENV === 'production' ? '/tmp/backup.json' : './backup.json';

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

// ===== SAVE =====
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function saveBackup() {
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
}

// ===== TRACKERS =====
let joinTracker = {};
let messageTracker = {};
let auditTracker = {};

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

  // FIX: permission check
  if (!guild.members.me.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  guild.channels.cache.forEach(ch => {
    ch.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false
    }).catch(() => {});
  });

  log(guild, "🚨 RAID → LOCKED");
}

// ===== RESTORE =====
async function restoreGuild(guild) {
  const data = backup[guild.id];
  if (!data) return;

  for (const ch of data) {
    await guild.channels.create({
      name: ch.name,
      type: ChannelType.GuildText, // FIXED
      parent: ch.parent
    }).catch(() => {});
  }

  log(guild, "🔄 RESTORED");
}

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
      log(message.guild, `🚫 Spam: ${message.author.tag}`);
    } catch {}
  }
});

// ===== ANTI-NUKE =====
client.on('channelDelete', async channel => {
  if (!channel.guild) return;

  backup[channel.guild.id] = channel.guild.channels.cache.map(ch => ({
    name: ch.name,
    parent: ch.parentId
  }));

  saveBackup();

  const logs = await channel.guild.fetchAuditLogs({ limit: 1 }).catch(() => {});
  const entry = logs?.entries.first();

  if (!entry) return;

  const user = entry.executor.id;

  auditTracker[user] = (auditTracker[user] || 0) + 1;

  if (auditTracker[user] > 3) {
    await lockServer(channel.guild);
  }
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Dashboard'),
  new SlashCommandBuilder().setName('setup').setDescription('Setup wizard')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

// FIX: safe register
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Commands loaded');
  } catch (err) {
    console.error(err);
  }
})();

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

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

    if (value === 'backup') {
      backup[id] = interaction.guild.channels.cache.map(ch => ({
        name: ch.name,
        parent: ch.parentId
      }));
      saveBackup();
    }

    if (value === 'restore') {
      await restoreGuild(interaction.guild);
    }

    saveData();

    return interaction.reply({ content: '✅ Updated', ephemeral: true });
  }

  // ===== BUTTONS =====

  if (interaction.commandName === 'setup') {
  await interaction.reply({
    content: `🛠️ Full Setup Starting...

Reply with this format (ALL VALUES REQUIRED):

\`\`\`
raidThreshold spamThreshold minAccountAge logChannelID
\`\`\`

Example:
\`\`\`
5 8 3 123456789012345678
\`\`\`

- raidThreshold = joins before raid triggers
- spamThreshold = messages before timeout
- minAccountAge = days old account must be
- logChannelID = channel ID for logs

⏳ You have 60 seconds.`,
    ephemeral: true
  });

  const filter = m => m.author.id === interaction.user.id;
  const collector = interaction.channel.createMessageCollector({ filter, max: 1, time: 60000 });

  collector.on('collect', msg => {
    const parts = msg.content.split(' ');

    if (parts.length < 4) return msg.reply('❌ Invalid format.');

    const [raid, spam, age, log] = parts.map(Number);

    const guildId = interaction.guild.id;
    if (!data[guildId]) data[guildId] = {};

    data[guildId].antiraid = true;
    data[guildId].raidThreshold = raid;
    data[guildId].spamThreshold = spam;
    data[guildId].minAccountAge = age;
    data[guildId].logChannel = parts[3]; // keep as string ID
    data[guildId].backupEnabled = true;

    saveData();

    msg.reply(`✅ FULL SETUP COMPLETE

🛡️ Anti-Raid: ON
💬 Spam Threshold: ${spam}
👶 Min Account Age: ${age} days
📜 Logs: <#${log}>
🔄 Backup: ENABLED`);
  });
}
  
// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
