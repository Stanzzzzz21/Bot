const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('CyberShield: Multi-Auth Active 🛡️'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ] 
});

const db = new Collection(); // In-memory DB (Use a file/real DB for permanent storage)
const nukeTracker = new Collection();
const msgTracker = new Collection();

// FIX: Ensure your ID is in this array to bypass "Owner Only" checks
const WHITELIST = ['YOUR_OWNER_ID']; 

const DEFAULT_CONFIG = {
    managerRole: null,
    logs: null,
    minAge: 1,
    spamLimit: 5,
    nukeLimit: 3,
    antiInvite: true
};

// ===== HELPER: PERMISSION CHECK =====
const hasAuth = (member, config) => {
    if (member.id === member.guild.ownerId) return true;
    if (WHITELIST.includes(member.id)) return true;
    if (config.managerRole && member.roles.cache.has(config.managerRole)) return true;
    return false;
};

// ===== 1. COMMAND REGISTRATION =====
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Initialize CyberShield and set Manager Role')
        .addRoleOption(o => o.setName('role').setDescription('Role that can manage CyberShield settings').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('configure')
        .setDescription('Tune security levels')
        .addIntegerOption(o => o.setName('age').setDescription('Min account age (days)'))
        .addIntegerOption(o => o.setName('spam').setDescription('Max messages per 3s'))
        .addIntegerOption(o => o.setName('nuke').setDescription('Max deletions per 10s'))
        .addBooleanOption(o => o.setName('invites').setDescription('Anti-Invite Toggle')),

    new SlashCommandBuilder().setName('settings').setDescription('View current security levels')
].map(c => c.toJSON());

// ===== 2. INTERACTION HANDLER =====
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    await int.deferReply({ ephemeral: true });

    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    // --- SETUP COMMAND (Owner/Whitelist Only) ---
    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) {
            return int.editReply("❌ **Setup** can only be run by the Server Owner.");
        }

        const role = int.options.getRole('role');
        config.managerRole = role.id;
        
        // Auto-create logs
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

        return int.editReply(`✅ **CyberShield Initialized.**\n- Manager Role: <@&${role.id}>\n- Log Channel: <#${logCh.id}>`);
    }

    // --- SECURITY CHECK FOR OTHER COMMANDS ---
    if (!hasAuth(int.member, config)) {
        return int.editReply("❌ **Access Denied:** You need the Manager Role or Owner permissions.");
    }

    if (int.commandName === 'configure') {
        const age = int.options.getInteger('age');
        const spam = int.options.getInteger('spam');
        const nuke = int.options.getInteger('nuke');
        const invites = int.options.getBoolean('invites');

        if (age !== null) config.minAge = age;
        if (spam !== null) config.spamLimit = spam;
        if (nuke !== null) config.nukeLimit = nuke;
        if (invites !== null) config.antiInvite = invites;

        db.set(int.guildId, config);
        return int.editReply("✅ **Security settings updated.**");
    }

    if (int.commandName === 'settings') {
        const embed = new EmbedBuilder()
            .setTitle("🛡️ CyberShield Live Configuration")
            .setColor("#2ecc71")
            .addFields(
                { name: "Cybershield Server Administrator", value: config.managerRole ? `<@&${config.managerRole}>` : "Not Set", inline: true },
                { name: "Age Gate", value: `${config.minAge} Days`, inline: true },
                { name: "Spam Limit", value: `${config.spamLimit} Msgs`, inline: true },
                { name: " Nuke Limit", value: `${config.nukeLimit} Actions`, inline: true }
            );
        return int.editReply({ embeds: [embed] });
    }
});

// ===== 3. AUTOMATED PROTECTION =====

// Join Gate
client.on('guildMemberAdd', async (member) => {
    const config = db.get(member.guild.id) || DEFAULT_CONFIG;
    const age = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (age < config.minAge) return member.kick("CyberShield: Age Gate").catch(() => null);
});

// Anti-Spam
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (hasAuth(msg.member, config)) return; // Don't flag authorized users

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
        await msg.member.timeout(600000, "Automated Spam Mitigation");
    }
});

// Anti-Nuke (Logic remains solid from previous version)
const checkNuke = async (guild, userId, action) => {
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
        logCh?.send(`🚨 **CyberShield:** Action limit exceeded by <@${userId}>. Roles stripped.`);
    }
};

client.on('channelDelete', (ch) => client.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete, guild: ch.guild }).then(a => checkNuke(ch.guild, a.entries.first()?.executor.id, "Deletion")));
client.on('roleDelete', (r) => client.fetchAuditLogs({ limit: 1, type: AuditLogEvent.RoleDelete, guild: r.guild }).then(a => checkNuke(r.guild, a.entries.first()?.executor.id, "Deletion")));

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands('1491381996025413764'), { body: commands });
    console.log("🛡️ CyberShield Multi-Auth Online");
});

client.login(process.env.TOKEN);
