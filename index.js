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

// ===== JOIN TRACK =====
let joinTracker = {};

function trackJoins(id) {
  const now = Date.now();
  if (!joinTracker[id]) joinTracker[id] = [];

  joinTracker[id].push(now);
  joinTracker[id] = joinTracker[id].filter(t => now - t < 10000);

  return joinTracker[id].length;
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
🛡️ I'm your security bot

⚙️ Run /setup to configure me

Features:
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

// ===== SETUP FLOW TRACKER =====
let setupStep = {};

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  // ===== COMMANDS =====
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'dashboard') {

      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Owner only', ephemeral: true });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('menu')
        .setPlaceholder('⚙️ Select option')
        .addOptions([
          { label: 'Enable Anti-Raid', value: 'on' },
          { label: 'Disable Anti-Raid', value: 'off' },
          { label: 'Create Logs Channel', value: 'logs' }
        ]);

      return interaction.reply({
        content: '⚙️ Dashboard',
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true
      });
    }

    // ===== START SETUP =====
    if (interaction.commandName === 'setup') {

      if (interaction.user.id !== interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ Owner only', ephemeral: true });
      }

      setupStep[interaction.guild.id] = 1;

      return interaction.reply({
        content: '🚀 Setup Started\n\nEnable Anti-Raid?',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('step_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('step_no').setLabel('No').setStyle(ButtonStyle.Danger)
          )
        ],
        ephemeral: true
      });
    }
  }

  // ===== SETUP BUTTON FLOW =====
  if (interaction.isButton()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    // STEP 1
    if (setupStep[id] === 1) {

      if (interaction.customId === 'step_yes') {
        data[id].antiraid = true;
      } else {
        data[id].antiraid = false;
      }

      setupStep[id] = 2;

      const modal = new ModalBuilder()
        .setCustomId('raid_threshold')
        .setTitle('Raid Threshold');

      const input = new TextInputBuilder()
        .setCustomId('raid_input')
        .setLabel('How many joins in 10 sec?')
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }
  }

  // ===== MODAL STEP =====
  if (interaction.isModalSubmit()) {

    const id = interaction.guild.id;
    if (!data[id]) data[id] = {};

    if (interaction.customId === 'raid_threshold') {

      const value = parseInt(interaction.fields.getTextInputValue('raid_input'));

      data[id].raidThreshold = value;

      setupStep[id] = 3;

      const embed = new EmbedBuilder()
        .setDescription('📊 Setup Complete\n\nRun /dashboard to manage settings');

      saveData();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ===== MENU =====
  if (interaction.isStringSelectMenu()) {

    const id = interaction.guild.id;

    if (interaction.values[0] === 'on') data[id].antiraid = true;
    if (interaction.values[0] === 'off') data[id].antiraid = false;

    if (interaction.values[0] === 'logs') {

      const ch = await interaction.guild.channels.create({
        name: 'bot-logs',
        type: ChannelType.GuildText
      });

      data[id].logChannel = ch.id;
    }

    saveData();

    return interaction.reply({ content: '✅ Updated', ephemeral: true });
  }
});

// ===== EVENTS =====
client.on('guildMemberAdd', async member => {

  const settings = getSettings(member.guild.id);

  if (!settings.antiraid) return;

  if (trackJoins(member.guild.id) >= (settings.raidThreshold || 5)) {
    await lockServer(member.guild);
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
