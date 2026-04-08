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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
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

function saveData() {
  fs.writeFileSync('./data.json', JSON.stringify(data, null, 2));
}

// ===== FLOW TRACKER =====
let setupFlow = {};

function nextStep(id) {
  setupFlow[id] = (setupFlow[id] || 1) + 1;
}

function prevStep(id) {
  setupFlow[id] = (setupFlow[id] || 1) - 1;
}

// ===== SETTINGS =====
function getSettings(id) {
  if (!data[id]) data[id] = {};
  return data[id];
}

// ===== LOG =====
function log(guild, msg) {
  const settings = getSettings(guild.id);
  if (!settings.logChannel) return;

  const ch = guild.channels.cache.get(settings.logChannel);
  if (!ch) return;

  ch.send({
    embeds: [new EmbedBuilder().setTitle("🛡️ Log").setDescription(msg)]
  }).catch(() => {});
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

// ===== WELCOME MESSAGE =====
client.on('guildCreate', async guild => {
  const channel = guild.systemChannel || guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
  if (!channel) return;

  channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('🚀 Thanks for adding me!')
        .setDescription(`
🛡️ I am your security bot

Run /setup to configure me

• Anti-Raid
• Spam Protection
• Auto Lockdown
• Logs System
        `)
    ]
  }).catch(() => {});
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

// ===== STEP FUNCTIONS =====
function askRaidThreshold(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('set_raid')
    .setTitle('Raid Threshold');

  const input = new TextInputBuilder()
    .setCustomId('raid_input')
    .setLabel('Joins in 10 seconds')
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function askSpamLimit(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('set_spam')
    .setTitle('Spam Limit');

  const input = new TextInputBuilder()
    .setCustomId('spam_input')
    .setLabel('Messages per 2 seconds')
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function askAccountAge(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('set_age')
    .setTitle('Account Age');

  const input = new TextInputBuilder()
    .setCustomId('age_input')
    .setLabel('Minimum age in days')
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function askLogChannel(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('set_logs')
    .setTitle('Log Channel');

  const input = new TextInputBuilder()
    .setCustomId('channel_input')
    .setLabel('Channel ID')
    .setStyle(TextInputStyle.Short);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function showSummary(interaction) {
  const id = interaction.guild.id;
  const s = data[id];

  const embed = new EmbedBuilder()
    .setTitle('📊 Setup Summary')
    .setDescription(`
Anti-Raid: ${s.antiraid}
Raid Threshold: ${s.raidThreshold}
Spam Limit: ${s.spamThreshold}
Account Age: ${s.minAccountAge / 86400000} days
Log Channel: ${s.logChannel}
    `);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_setup').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('back').setLabel('Back').setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  // COMMANDS
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'setup') {

      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Owner only', ephemeral: true });
      }

      setupFlow[interaction.guild.id] = 1;

      return interaction.reply({
        content: '🚀 Enable Anti-Raid?',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('enable_raid').setLabel('Enable').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('disable_raid').setLabel('Disable').setStyle(ButtonStyle.Danger)
          )
        ],
        ephemeral: true
      });
    }
  }

  // BUTTONS
  if (interaction.isButton()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    if (interaction.customId === 'enable_raid' || interaction.customId === 'disable_raid') {
      data[id].antiraid = interaction.customId === 'enable_raid';
      nextStep(id);
      return askRaidThreshold(interaction);
    }

    if (interaction.customId === 'confirm_setup') {
      saveData();
      return interaction.reply({ content: '✅ Setup Complete!', ephemeral: true });
    }

    if (interaction.customId === 'back') {
      prevStep(id);
    }
  }

  // MODALS
  if (interaction.isModalSubmit()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    if (interaction.customId === 'set_raid') {
      data[id].raidThreshold = parseInt(interaction.fields.getTextInputValue('raid_input'));
      return askSpamLimit(interaction);
    }

    if (interaction.customId === 'set_spam') {
      data[id].spamThreshold = parseInt(interaction.fields.getTextInputValue('spam_input'));
      return askAccountAge(interaction);
    }

    if (interaction.customId === 'set_age') {
      data[id].minAccountAge = parseInt(interaction.fields.getTextInputValue('age_input')) * 86400000;
      return askLogChannel(interaction);
    }

    if (interaction.customId === 'set_logs') {
      data[id].logChannel = interaction.fields.getTextInputValue('channel_input');
      return showSummary(interaction);
    }
  }
});

// ===== EVENTS =====
client.on('guildMemberAdd', async member => {

  const settings = getSettings(member.guild.id);

  if (!settings.antiraid) return;

  if (!settings.raidThreshold) settings.raidThreshold = 5;

  if (member.guild.members.cache.size >= settings.raidThreshold) {
    await lockServer(member.guild);
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
