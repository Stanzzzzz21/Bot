const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- KEEP ALIVE SYSTEM START ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('CyberShield is Pulse-Active 🛡️');
});

app.listen(port, () => {
  console.log(`Keep-Alive server running on port ${port}`);
});

// FIXED PING LOGIC (Using native fetch available in Node 18+)
setInterval(() => {
  const myUrl = "https://bot-gyyu.onrender.com"; 
  
  fetch(myUrl)
    .then(() => console.log('🛡️ CyberShield Pulse: OK'))
    .catch(err => console.log('🛡️ Pulse Failed: Bot is likely asleep.'));
}, 60000); 
// --- KEEP ALIVE SYSTEM END ---

// FIXED INTENTS (Listing them explicitly prevents Status 1 crashes)
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ] 
});

const db = new Collection(); 
const nukeTracker = new Collection();
const msgTracker = new Collection();
let joinTracker = []; // Changed to let so we can clean it

// 🔑 MASTER WHITELIST
const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = {
    managerRole: null,
    logs: null,
    minAge: 1,
    spamLimit: 5,
    nukeLimit: 3,
    antiInvite: true,
    joinLimit: 5
};

// ===== AUTHENTICATION ENGINE =====
const isAuth = (int, config) => {
    if (int.user.id === int.guild.ownerId) return true;
    if (WHITELIST.includes(int.user.id)) return true;
    if (config.managerRole && int.member.roles.cache.has(config.managerRole)) return true;
    return false;
};

// ===== COMMAND REGISTRATION =====
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Initialize CyberShield & Set Manager Role')
        .addRoleOption(o => o.setName('role').setDescription('Role allowed to manage security').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('configure')
        .setDescription('Adjust security sensitivity')
        .addIntegerOption(o => o.setName('age').setDescription('Min account age (days)'))
        .addIntegerOption(o => o.setName('spam').setDescription('Max messages per 3s'))
        .addIntegerOption(o => o.setName('nuke').setDescription('Max deletions per 10s'))
        .addBooleanOption(o => o.setName('invites').setDescription('Block Discord Invites')),

    new SlashCommandBuilder().setName('settings').setDescription('View current security levels'),
    new SlashCommandBuilder().setName('audit').setDescription('Scan for webhooks and admin risks')
].map(c => c.toJSON());

client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;

    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) {
            return int.reply({ content: "❌ **Error:** Only the Server Owner can run setup.", ephemeral: true });
        }
        await int.deferReply({ ephemeral: true });
        const role = int.options.getRole('role');
        config.managerRole = role.id;
        
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs');
        if (!logCh) {
            logCh = await int.guild.channels.create({
                name: 'shield-logs',
                type: ChannelType.GuildText,
                permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
            });
        }
        config.logs = logCh.id;
        db.set(int.guildId, config);
        return int.editReply(`✅ **CyberShield Initialized.** Role <@&${role.id}> can now use security commands.`);
    }

    if (!isAuth(int, config)) {
        return int.reply({ content: "❌ **Access Denied.**", ephemeral: true });
    }

    if (int.commandName === 'configure') {
        await int.deferReply({ ephemeral: true });
        const age = int.options.getInteger('age');
        const spam = int.options.getInteger('spam');
        const nuke = int.options.getInteger('nuke');
        const invites = int.options.getBoolean('invites');

        if (age !== null) config.minAge = age;
        if (spam !== null) config.spamLimit = spam;
        if (nuke !== null) config.nukeLimit = nuke;
        if (invites !== null) config.antiInvite = invites;

        db.set(int.guildId, config);
        return int.editReply("✅ **Settings Saved.**");
    }

    if (int.commandName === 'settings') {
        await int.deferReply({ ephemeral: true });
        const embed = new EmbedBuilder()
            .setTitle("🛡️ CyberShield Configuration")
            .setColor("#2ecc71")
            .addFields(
                { name: "Manager Role", value: config.managerRole ? `<@&${config.managerRole}>` : "None", inline: true },
                { name: "Age Gate", value: `${config.minAge} Days`, inline: true },
                { name: "Nuke Threshold", value: `${config.nukeLimit} Actions`, inline: true },
                { name: "Anti-Invite", value: config.antiInvite ? "ON" : "OFF", inline: true }
            );
        return int.editReply({ embeds: [embed] });
    }

    if (int.commandName === 'audit') {
        await int.deferReply({ ephemeral: true });
        const hooks = await int.guild.fetchWebhooks();
        return int.editReply(`🛡️ **Audit:** ${hooks.size} Webhooks | ${int.guild.members.cache.filter(m => m.permissions.has(PermissionsBitField.Flags.Administrator)).size} Admins.`);
    }
});

// ===== 🤖 AUTOMATED SECURITY LAYERS =====

client.on('guildMemberAdd', async (member) => {
    const config = db.get(member.guild.id) || DEFAULT_CONFIG;
    const now = Date.now();
    
    const age = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (age < config.minAge) return member.kick("CyberShield: Age Gate").catch(() => null);

    joinTracker.push(now);
    // Cleanup old joins to prevent memory leaks
    if (joinTracker.filter(t => t > now - 10000).length > config.joinLimit) {
        return member.kick("CyberShield: Raid Mitigation").catch(() => null);
    }
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (msg.author.id === msg.guild.ownerId || (config.managerRole && msg.member.roles.cache.has(config.managerRole))) return;

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        return msg.delete().catch(() => null);
    }

    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    const now = Date.now();
    if (now - userData.last < 3000) userData.count++;
    else userData.count = 1;
    userData.last = now;
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(600000, "CyberShield: Anti-Spam").catch(() => null);
    }
});

const checkNuke = async (guild, userId, action) => {
    if (!guild || !userId) return;
    const config = db.get(guild.id) || DEFAULT_CONFIG;
    if (userId === guild.ownerId || WHITELIST.includes(userId)) return;

    let data = nukeTracker.get(userId) || { count: 0, last: Date.now() };
    const now = Date.now();
    if (now - data.last < 10000) data.count++;
    else data.count = 1;
    data.last = now;
    nukeTracker.set(userId, data);

    if (data.count >= config.nukeLimit) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.roles.set([]).catch(() => null);
        const logCh = guild.channels.cache.get(config.logs);
        logCh?.send(`🚨 **CyberShield:** Admin <@${userId}> restricted for mass **${action}**.`);
    }
};

client.on('channelDelete', (ch) => ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).then(a => checkNuke(ch.guild, a.entries.first()?.executor.id, "Channel Deletion")));
client.on('roleDelete', (r) => r.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete }).then(a => checkNuke(r.guild, a.entries.first()?.executor.id, "Role Deletion")));

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands('1491381996025413764'), { body: commands });
        console.log("🛡️ CyberShield Complete Edition: Online");
    } catch (error) {
        console.error("Command Registration Error:", error);
    }
});

client.on('guildCreate', async (guild) => {
    const welcomeChannel = guild.systemChannel || guild.channels.cache.find(ch => 
        ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
    );

 

client.login(process.env.TOKEN);
