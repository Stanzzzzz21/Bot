const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent, EmbedBuilder 
} = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.status(200).send('CyberShield Active 🟢'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration 
    ] 
});

const db = new Collection(); 
const msgTracker = new Collection();
const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = { 
    adminRole: null, logChannel: null, minAge: 3, 
    spamLimit: 5, antiInvite: true, antiMention: true, 
    antiNuke: true, timeoutMinutes: 10 
};

// --- HELPER: LOGGING ---
async function sendLog(guild, { title, msg, color = 0x2b2d31 }) {
    try {
        const config = db.get(guild.id);
        if (!config || !config.logChannel) return;
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setDescription(msg).setColor(color).setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) { console.error("Log failed."); }
}

// --- COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Admin Role and Logs')
        .addRoleOption(o => o.setName('role').setRequired(true).setDescription('Admin role')),
    
    new SlashCommandBuilder().setName('configure').setDescription('Customize security settings')
        .addIntegerOption(o => o.setName('age').setDescription('Min account age (days)'))
        .addIntegerOption(o => o.setName('spam').setDescription('Max messages / 3s'))
        .addIntegerOption(o => o.setName('timeout').setDescription('Timeout duration (minutes)'))
        .addBooleanOption(o => o.setName('invites').setDescription('Anti-Invite Toggle'))
        .addBooleanOption(o => o.setName('mentions').setDescription('Anti-Mention Toggle'))
        .addBooleanOption(o => o.setName('nuke').setDescription('Anti-Nuke Toggle')),

    new SlashCommandBuilder().setName('settings').setDescription('View security dashboard'),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages').addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('user').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('user').setRequired(true))
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    await int.deferReply({ ephemeral: true }).catch(() => null);
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.editReply("❌ Owner Only.");
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
        config.adminRole = int.options.getRole('role').id;
        config.logChannel = logCh?.id || null;
        db.set(int.guildId, config);
        return int.editReply(`✅ Setup complete. Logs: <#${config.logChannel}>`);
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("❌ Unauthorized.");

    if (int.commandName === 'configure') {
        config.minAge = int.options.getInteger('age') ?? config.minAge;
        config.spamLimit = int.options.getInteger('spam') ?? config.spamLimit;
        config.timeoutMinutes = int.options.getInteger('timeout') ?? config.timeoutMinutes;
        if (int.options.getBoolean('invites') !== null) config.antiInvite = int.options.getBoolean('invites');
        if (int.options.getBoolean('mentions') !== null) config.antiMention = int.options.getBoolean('mentions');
        if (int.options.getBoolean('nuke') !== null) config.antiNuke = int.options.getBoolean('nuke');
        db.set(int.guildId, config);
        return int.editReply("✅ Configuration updated.");
    }

    if (int.commandName === 'settings') {
        const embed = new EmbedBuilder().setTitle('🛡️ Current Settings').setColor(0x5865f2)
            .addFields(
                { name: 'Anti-Invite', value: config.antiInvite ? '✅' : '❌', inline: true },
                { name: 'Anti-Mention', value: config.antiMention ? '✅' : '❌', inline: true },
                { name: 'Anti-Nuke', value: config.antiNuke ? '✅' : '❌', inline: true },
                { name: 'Age Gate', value: `${config.minAge} Days`, inline: true },
                { name: 'Timeout', value: `${config.timeoutMinutes}m`, inline: true }
            );
        return int.editReply({ embeds: [embed] });
    }

    if (int.commandName === 'purge') {
        const amt = int.options.getInteger('amount');
        await int.channel.bulkDelete(Math.min(amt, 100), true);
        return int.editReply(`Cleared ${amt} messages.`);
    }
});

// --- ANTI-NUKE ---
client.on('channelDelete', async (ch) => {
    const config = db.get(ch.guild?.id) || DEFAULT_CONFIG;
    if (!ch.guild || !config.antiNuke) return;
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const exec = logs?.entries.first()?.executor;
    if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

    await ch.guild.channels.create({
        name: ch.name, type: ch.type, parent: ch.parentId,
        permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
    }).catch(() => null);
    await sendLog(ch.guild, { title: "Nuke Intercepted", msg: `Restored: **${ch.name}**\nBy: **${exec?.tag}**`, color: 0xff0000 });
});

// --- AUTO-DEFENSE ---
client.on('guildMemberAdd', async (m) => {
    const config = db.get(m.guild.id) || DEFAULT_CONFIG;
    if (["discord.gg/", "free-nitro", "nuke-bot", "nitro-gift"].some(t => m.user.username.toLowerCase().includes(t))) {
        await m.ban({ reason: "Scam Name" }).catch(() => null);
        return sendLog(m.guild, { title: "Scam Ban", msg: `Banned: ${m.user.tag}`, color: 0xff0000 });
    }
    if ((Date.now() - m.user.createdTimestamp) / 86400000 < config.minAge) {
        await m.kick("Age Gate").catch(() => null);
        return sendLog(m.guild, { title: "Age Gate Kick", msg: `Kicked: ${m.user.tag}`, color: 0x95a5a6 });
    }
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    if (config.antiMention && (msg.mentions.users.size > 5 || msg.content.includes('@everyone'))) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(config.timeoutMinutes * 60000).catch(() => null);
        return sendLog(msg.guild, { title: "Mention Spam", msg: `${msg.author.tag} timed out.`, color: 0xf1c40f });
    }

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        await msg.delete().catch(() => null);
        return sendLog(msg.guild, { title: "Invite Blocked", msg: `From: ${msg.author.tag}`, color: 0xf1c40f });
    }

    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++; else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(config.timeoutMinutes * 60000).catch(() => null);
        return sendLog(msg.guild, { title: "Spam Filter", msg: `${msg.author.tag} timed out.`, color: 0xf1c40f });
    }
});

// --- BEAUTIFIED WELCOME MESSAGE ---
client.on('guildCreate', async (guild) => {
    const chan = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (chan) {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ CyberShield Deployment Success')
            .setColor(0x57f287)
            .setDescription('Ready to protect your server. Please run `/setup` to begin.')
            .addFields(
                { name: '✨ Features', value: '• Anti-Scam\n• Anti-Spam\n• Anti-Invite\n• Anti-Mention\n• Anti-Nuke\n• Age-Gate', inline: true },
                { name: '⚙️ Recommended Settings', value: '• Age Gate: 3 Days\n• Spam Limit: 5 msgs / 3s\n• Anti-Invite: Enabled\n• Anti-Nuke: Enabled', inline: true }
            )
            .setFooter({ text: 'This message will self-delete in 4 minutes.' });

        chan.send({ embeds: [embed] }).then(m => setTimeout(() => m.delete().catch(() => null), 240000));
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(() => null);
    console.log(`🛡️ ${client.user.tag} Online`);
});

client.login(process.env.TOKEN);
