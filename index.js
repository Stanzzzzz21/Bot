const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

const express = require('express');
const fs = require('fs');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 3000);

// ===== CONFIG =====
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

// ===== LOGGING =====
function log(guild, msg) {
  const settings = getSettings(guild.id);
  if (!settings.logChannel) return;

  const channel = guild.channels.cache.get(settings.logChannel);
  if (!channel) return;

  channel.send({
    embeds: [{
      title: "🛡️ Security Log",
      description: msg,
      color: 0x00ffcc,
      timestamp: new Date()
    }]
  }).catch(() => {});
}

// ===== RAID DETECTION =====
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

// ===== LOCKDOWN =====
async function lockServer(guild) {
  guild.channels.cache
    .filter(c => c.isTextBased())
    .forEach(ch => {
      ch.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false
      }).catch(() => {});
    });

  log(guild, '🚨 RAID DETECTED → LOCKED');

  setTimeout(() => {
    guild.channels.cache
      .filter(c => c.isTextBased())
      .forEach(ch => {
        ch.permissionOverwrites.edit(guild.roles.everyone, {
          SendMessages: null
        }).catch(() => {});
      });

    log(guild, '🔓 UNLOCKED');
  }, 60000);
}

// ===== EVENTS =====
client.on('guildMemberAdd', async member => {
  const id = member.guild.id;
  const settings = getSettings(id);

  if (!settings.antiraid) return;

  // JOIN RAID CHECK
  const joins = trackJoins(id);

  if (joins >= settings.raidThreshold) {
    await lockServer(member.guild);
  }

  // ACCOUNT AGE FILTER
  if (Date.now() - member.user.createdTimestamp < settings.minAccountAge) {
    try {
      await member.timeout(60000, 'New account detected');
      log(member.guild, `👶 New account: ${member.user.tag}`);
    } catch {}
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const settings = getSettings(message.guild.id);

  if (!settings.antiraid) return;

  const count = trackMessages(message.author.id, message.guild.id);

  if (count >= settings.spamThreshold) {
    try {
      await message.delete();
      await message.member.timeout(60000, 'Spam detected');
      log(message.guild, `🚫 Spam: ${message.author.tag}`);
    } catch {}
  }
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('dashboard').setDescription('Setup bot')
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Commands registered');
})();

// ===== DASHBOARD =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'dashboard') {
    if (interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Owner only', ephemeral: true });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('setup')
      .setPlaceholder('⚙️ Setup')
      .addOptions([
        { label: 'Enable Anti-Raid', value: 'on' },
        { label: 'Disable Anti-Raid', value: 'off' },
        { label: 'Set Logs Channel', value: 'logs' },
        { label: 'Set Raid Limit', value: 'raid' },
        { label: 'Set Spam Limit', value: 'spam' },
        { label: 'Set Account Age (days)', value: 'age' }
      ]);

    await interaction.reply({
      content: '⚙️ Setup Panel',
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });
  }
});


//=======restore system 

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

//=====anti nuke 

const auditTracker = {};

async function checkNuke(guild) {
  const logs = await guild.fetchAuditLogs({ limit: 5 });
  const entry = logs.entries.first();

  if (!entry) return;

  const executor = entry.executor.id;

  if (!auditTracker[executor]) auditTracker[executor] = 0;

  auditTracker[executor]++;

  if (auditTracker[executor] > 3) {
    // LOCK SERVER
    guild.channels.cache.forEach(ch => {
      ch.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false
      }).catch(() => {});
    });

    console.log("NUKE DETECTED");
  }
}


//====quarantine 

async function quarantine(member) {
  let role = member.guild.roles.cache.find(r => r.name === 'Quarantine');

  if (!role) {
    role = await member.guild.roles.create({
      name: 'Quarantine',
      permissions: []
    });
  }

  await member.roles.set([role]).catch(() => {});
}

//=====backup auto 

client.on('channelDelete', async channel => {
  if (!channel.guild) return;

  saveBackup(channel.guild);
  console.log("Backup saved");
});

client.on('channelCreate', async channel => {
  if (!channel.guild) return;

  saveBackup(channel.guild);
});



// ===== MENU HANDLER =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;

  const id = interaction.guild.id;

  if (interaction.user.id !== interaction.guild.ownerId) {
    return interaction.reply({ content: '❌ Owner only', ephemeral: true });
  }

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

  if (value === 'raid') {
    data[id].waitingRaid = true;
    return interaction.reply({ content: 'Send raid limit number', ephemeral: true });
  }

  if (value === 'spam') {
    data[id].waitingSpam = true;
    return interaction.reply({ content: 'Send spam limit number', ephemeral: true });
  }

  if (value === 'age') {
    data[id].waitingAge = true;
    return interaction.reply({ content: 'Send account age (days)', ephemeral: true });
  }

  { label: 'Create Backup', value: 'backup' },
{ label: 'Restore Backup', value: 'restore' },
{ label: 'Enable Anti-Nuke', value: 'nuke_on' }

  saveData();
  interaction.reply({ content: '✅ Updated', ephemeral: true });
});

// ===== INPUT HANDLER =====
client.on('messageCreate', message => {
  if (message.author.bot) return;

  const id = message.guild?.id;
  if (!id) return;

  if (data[id]?.waitingRaid) {
    const num = parseInt(message.content);
    if (!isNaN(num)) {
      data[id].raidThreshold = num;
      data[id].waitingRaid = false;
      saveData();
      message.reply(`✅ Raid limit set`);
    }
  }

  if (data[id]?.waitingSpam) {
    const num = parseInt(message.content);
    if (!isNaN(num)) {
      data[id].spamThreshold = num;
      data[id].waitingSpam = false;
      saveData();
      message.reply(`✅ Spam limit set`);
    }
  }

  if (data[id]?.waitingAge) {
    const num = parseInt(message.content);
    if (!isNaN(num)) {
      data[id].minAccountAge = num * 24 * 60 * 60 * 1000;
      data[id].waitingAge = false;
      saveData();
      message.reply(`✅ Account age set`);
    }
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

if (value === 'backup') {
  saveBackup(interaction.guild);
  return interaction.reply({ content: '✅ Backup saved', ephemeral: true });
}

if (value === 'restore') {
  await restoreGuild(interaction.guild);
  return interaction.reply({ content: '🔁 Restored', ephemeral: true });
}

if (value === 'nuke_on') {
  data[id].antinuke = true;
}

client.login(TOKEN);
