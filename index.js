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

const fs = require('fs');

client.login(process.env.TOKEN);
const CLIENT_ID = '1491381996025413764';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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

  channel.send(`📊 ${message}`);
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
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
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

      { label: 'Anti-Raid ON', value: 'raid_on' },
      { label: 'Anti-Raid OFF', value: 'raid_off' },

      { label: 'Logs ON', value: 'logs_on' },
      { label: 'Logs OFF', value: 'logs_off' },

      { label: 'Commands: Admin', value: 'role_admin' },
      { label: 'Commands: Mod', value: 'role_mod' },
      { label: 'Commands: Everyone', value: 'role_all' },

      { label: 'Advanced Protection ON', value: 'adv_on' },
      { label: 'Advanced Protection OFF', value: 'adv_off' }
    ]);

  channel.send({
    content: '🛡️ Setup your bot:',
    components: [new ActionRowBuilder().addComponents(menu)]
  });
});

// ===== RAID TRACKING =====
let raidMode = false;
let joins = [];

// ===== INTERACTIONS =====
client.on('interactionCreate', async interaction => {

  // DROPDOWN
  if (interaction.isStringSelectMenu()) {
    if (interaction.user.id !== interaction.guild.ownerId)
      return interaction.reply({ content: 'Owner only', ephemeral: true });

    const id = interaction.guild.id;
    const value = interaction.values[0];

    if (!data[id]) data[id] = {};

    if (value === 'spam_5') data[id].spam = 5;
    if (value === 'spam_10') data[id].spam = 10;

    if (value === 'raid_on') data[id].raid = true;
    if (value === 'raid_off') data[id].raid = false;

    if (value === 'logs_on') data[id].logs = true;
    if (value === 'logs_off') data[id].logs = false;

    if (value === 'role_admin') data[id].role = 'admin';
    if (value === 'role_mod') data[id].role = 'mod';
    if (value === 'role_all') data[id].role = 'all';

    if (value === 'adv_on') data[id].advanced = true;
    if (value === 'adv_off') data[id].advanced = false;

    saveData();

    return interaction.reply({ content: `Saved: ${value}`, ephemeral: true });
  }

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    const id = interaction.guild.id;

    if (!hasPermission(interaction.member, id)) {
      return interaction.reply({ content: '❌ No permission', ephemeral: true });
    }

    if (interaction.commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const member = interaction.guild.members.cache.get(user.id);

      await member.kick();
      sendLog(interaction.guild, `${user.tag} kicked`);
      return interaction.reply(`Kicked ${user.tag}`);
    }

    if (interaction.commandName === 'ban') {
      const user = interaction.options.getUser('user');
      const member = interaction.guild.members.cache.get(user.id);

      await member.ban();
      sendLog(interaction.guild, `${user.tag} banned`);
      return interaction.reply(`Banned ${user.tag}`);
    }

    if (interaction.commandName === 'setlogs') {
      const channel = interaction.options.getChannel('channel');

      data[id].logChannel = channel.id;
      saveData();

      return interaction.reply(`Log channel set`);
    }
  }
});

// ===== ANTI RAID =====
client.on('guildMemberAdd', member => {
  const id = member.guild.id;

  if (!data[id]?.raid) return;

  const now = Date.now();
  joins.push(now);

  joins = joins.filter(t => now - t < 10000);

  if (joins.length > 5) {
    raidMode = true;

    member.guild.channels.cache.forEach(ch => {
      if (ch.isTextBased()) {
        ch.permissionOverwrites.edit(member.guild.roles.everyone, {
          SendMessages: false
        });
      }
    });

    setTimeout(() => raidMode = false, 300000);
  }
});

// ===== ANTI SPAM =====
const messages = new Map();

client.on('messageCreate', msg => {
  if (msg.author.bot) return;

  const id = msg.guild.id;
  const limit = data[id]?.spam || 5;

  const now = Date.now();
  const user = msg.author.id;

  const times = messages.get(user) || [];
  times.push(now);

  const recent = times.filter(t => now - t < 5000);
  messages.set(user, recent);

  if (recent.length > limit) {
    msg.member.timeout(60000);

    sendLog(msg.guild, `${msg.author.tag} spammed`);
  }
});

// ===== CHANNEL RESTORE =====
client.on('channelDelete', async channel => {
  if (!raidMode) return;

  try {
    await channel.guild.channels.create({
      name: channel.name,
      type: channel.type,
      parent: channel.parentId
    });

    sendLog(channel.guild, `Channel restored: ${channel.name}`);
  } catch (e) {
    console.log(e);
  }
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
