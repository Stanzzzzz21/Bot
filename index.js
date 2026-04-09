const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent, EmbedBuilder 
} = require('discord.js');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
app.get('/', (req, res) => res.status(200).send('CyberShield Active 🟢'));
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

const db = new Collection(); 
const msgTracker = new Collection();
const WHITELIST = ['876731494805155851']; 

// Recommended Security Defaults
const DEFAULT_CONFIG = { 
    adminRole: null, 
    logChannel: null, 
    minAge: 3, 
    spamLimit: 5, 
    antiInvite: true 
};

// --- HELPER: LOGGING (Guaranteed Text) ---
async function sendLog(guild, { title, msg, color = 0x2b2d31 }) {
    try {
        const config = db.get(guild.id);
        if (!config || !config.logChannel) return;
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(`🛡️ ${title}`)
            .setDescription(msg)
            .setColor(color)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) { console.error("Log failed - Check channel permissions."); }
}

// --- COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Admin and Logs with Recommended Settings').addRoleOption(o => o.setName('role').setRequired(true).setDescription('Admin role')),
    new SlashCommandBuilder().setName('configure').setDescription('Update settings').addIntegerOption(o => o.setName('age').setDescription('Min age')).addIntegerOption(o => o.setName('spam').setDescription('Spam limit')).addBooleanOption(o => o.setName('invites').setDescription('Block invites')),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages').addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Amount')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('user').setRequired(true).setDescription('Target')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('user').setRequired(true).setDescription('Target'))
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    
    // Safety for long-running tasks
    await int.deferReply({ ephemeral: true }).catch(() => null);
    
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.editReply("❌ Error: Owner Only.");
        
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', 
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);

        config.adminRole = int.options.getRole('role').id;
        config.logChannel = logCh?.id || null;
        config.minAge = 3; 
        config.antiInvite = true;
        
        db.set(int.guildId, config);
        
        await sendLog(int.guild, { title: "System Online", msg: `**Configured by:** ${int.user.tag}\n**Admin Role:** <@&${config.adminRole}>\n**Settings:** Recommended Security Defaults Applied.`, color: 0x57f287 });
        return int.editReply(`✅ **Setup Complete:** Logs in <#${config.logChannel}>`);
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("❌ Access Denied.");

    try {
        if (int.commandName === 'configure') {
            config.minAge = int.options.getInteger('age') ?? config.minAge;
            config.spamLimit = int.options.getInteger('spam') ?? config.spamLimit;
            if (int.options.getBoolean('invites') !== null) config.antiInvite = int.options.getBoolean('invites');
            db.set(int.guildId, config);
            await sendLog(int.guild, { title: "Settings Updated", msg: `**Moderator:** ${int.user.tag}\n**Update:** Security configuration has been modified via /configure.`, color: 0x3498db });
            return int.editReply("Settings updated.");
        }
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            await int.channel.bulkDelete(Math.min(amt, 100), true);
            await sendLog(int.guild, { title: "Chat Purged", msg: `**Moderator:** ${int.user.tag}\n**Action:** Cleared ${amt} messages in ${int.channel.name}`, color: 0x3498db });
            return int.editReply(`Cleared ${amt} messages.`);
        }
        if (int.commandName === 'kick' || int.commandName === 'ban') {
            const target = int.options.getMember('user');
            if (int.commandName === 'kick') {
                await target.kick();
                await sendLog(int.guild, { title: "User Kicked", msg: `**Target:** ${target.user.tag}\n**Moderator:** ${int.user.tag}`, color: 0xffa500 });
            } else {
                await target.ban();
                await sendLog(int.guild, { title: "User Banned", msg: `**Target:** ${target.user.tag}\n**Moderator:** ${int.user.tag}`, color: 0xff0000 });
            }
            return int.editReply(`Action completed.`);
        }
    } catch (e) { return int.editReply("Execution Error. Check Bot Permissions."); }
});

// --- ANTI-NUKE ---
client.on('channelDelete', async (ch) => {
    if (!ch.guild) return;
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const exec = logs?.entries.first()?.executor;
    if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

    await ch.guild.channels.create({
        name: ch.name, type: ch.type, parent: ch.parentId,
        permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
    }).catch(() => null);
    await sendLog(ch.guild, { title: "Nuke Intercepted", msg: `**Channel Restored:** ${ch.name}\n**Deleted by:** ${exec?.tag || 'Unknown'}\n**Action:** Channel recreated.`, color: 0xff0000 });
});

// --- AUTO-DEFENSE ---
client.on('guildMemberAdd', async (m) => {
    const config = db.get(m.guild.id) || DEFAULT_CONFIG;
    const logRef = config.logChannel ? `check <#${config.logChannel}> for more info.` : "check #shield-logs for more info.";

    if (["discord.gg/", "free-nitro", "nuke-bot", "nitro-gift"].some(t => m.user.username.toLowerCase().includes(t))) {
        await m.ban({ reason: "Scam Username" }).catch(() => null);
        const chan = m.guild.systemChannel || m.guild.channels.cache.find(c => c.type === ChannelType.GuildText);
        if (chan) chan.send(`⚠️ **Anti-Scam: Auto-bans users with "nitro scam" or "nuke-bot" names. ${logRef}**`).then(msg => setTimeout(() => msg.delete(), 6000));
        return sendLog(m.guild, { title: "Scam Ban", msg: `**User:** ${m.user.tag}\n**Reason:** Malicious username (Scam Filter).\n**Action:** Permanent Ban.`, color: 0xff0000 });
    }

    if ((Date.now() - m.user.createdTimestamp) / 86400000 < config.minAge) {
        await m.kick("Age Gate").catch(() => null);
        return sendLog(m.guild, { title: "Age Gate Kick", msg: `**User:** ${m.user.tag}\n**Reason:** Account age less than required ${config.minAge} days.\n**Action:** User Kicked.`, color: 0x95a5a6 });
    }
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    const logRef = config.logChannel ? `check <#${config.logChannel}> for more info.` : "check #shield-logs for more info.";

    if (msg.mentions.users.size > 5 || msg.content.includes('@everyone')) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(3600000).catch(() => null);
        msg.channel.send(`**⚠️ Anti-Mention: Blocks mass pings + automatic 1hr timeout. ${logRef}**`).then(m => setTimeout(() => m.delete(), 6000)).catch(() => null);
        return sendLog(msg.guild, { title: "Mention Spam", msg: `**User:** ${msg.author.tag}\n**Action:** Message Deleted + 1 Hour Timeout.\n**Reason:** Exceeded mention limit/Pinged @everyone.`, color: 0xf1c40f });
    }

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        await msg.delete().catch(() => null);
        msg.channel.send(`**🚫 Anti-Invite: Blocks unauthorized server invites. ${logRef}**`).then(m => setTimeout(() => m.delete(), 6000)).catch(() => null);
        return sendLog(msg.guild, { title: "Invite Blocked", msg: `**User:** ${msg.author.tag}\n**Action:** Unauthorized Discord Invite link removed.`, color: 0xf1c40f });
    }

    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++; else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(600000).catch(() => null);
        msg.channel.send(`**🛑 Anti-Spam: Rate-limiting for chat messages. ${logRef}**`).then(m => setTimeout(() => m.delete(), 6000)).catch(() => null);
        return sendLog(msg.guild, { title: "Spam Filter", msg: `**User:** ${msg.author.tag}\n**Action:** Message Deleted + 10 Minute Timeout.\n**Reason:** Sent messages too rapidly.`, color: 0xf1c40f });
    }
});

client.on('guildCreate', async (guild) => {
    const welcome = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
    if (welcome) {
        welcome.send(`🛡️ **CyberShield Active.** \nUse \`/setup\` to authorize a Server Administrator and initialize logs. \n*This message will self-delete in 4 minutes.*`)
        .then(msg => { setTimeout(() => msg.delete().catch(() => null), 240000); }).catch(() => null);
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(() => null);
    console.log(`🛡️ ${client.user.tag} Online`);
});

client.login(process.env.TOKEN);
