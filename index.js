const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder, 
    ChannelType, PermissionsBitField, Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// ===== 1. SERVER & ENGINE SETUP =====
const app = express();
app.get('/', (req, res) => res.send('Cybershield is here!: ACTIVE'));
const webServer = app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildAuditLogs // Added for human action tracking
    ]
});

const db = new Collection(); 
const antiSpamCache = new Collection();
const antiNukeCache = new Collection();

const CLIENT_ID = '1491381996025413764'; 
const TOKEN = process.env.TOKEN;

// Helper to find log channel by name or ID
const getLogChannel = (guild) => {
    const config = db.get(guild.id);
    return guild.channels.cache.get(config?.logChannel) || guild.channels.cache.find(c => c.name === 'shield-logs');
};

// ===== 2. GLOBAL COMMAND REGISTRATION =====
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure security, mod roles, and logs')
        .addStringOption(o => o.setName('mod_role_name').setDescription('Name for your Moderator role'))
        .addIntegerOption(o => o.setName('spam_sensitivity').setDescription('Messages allowed per 5s (Default: 5)')),
    new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Freeze the current channel')
        .addBooleanOption(o => o.setName('status').setDescription('True = Locked, False = Unlocked').setRequired(true)),
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to ban'))
        .addStringOption(o => o.setName('reason').setDescription('Reason for ban')),
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to kick'))
        .addStringOption(o => o.setName('reason').setDescription('Reason for kick')),
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mute a user (Timeout)')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to mute'))
        .addIntegerOption(o => o.setName('minutes').setRequired(true).setDescription('Duration in minutes')),
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View global bot performance')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('🔄 Syncing Global Commands...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Commands Synced Successfully');
    } catch (e) { console.error('❌ Command Sync Error:', e); }
})();

// ===== 3. AUTOMATED EVENTS (Anti-Spam & Anti-Nuke) =====

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id);
    const limit = config?.spamLimit || 5;
    const now = Date.now();
    const timestamps = antiSpamCache.get(msg.author.id) || [];
    timestamps.push(now);
    const filtered = timestamps.filter(t => now - t < 5000);
    antiSpamCache.set(msg.author.id, filtered);

    if (filtered.length > limit) {
        await msg.member.timeout(600000, "Automated Anti-Spam").catch(() => {});
        await msg.channel.bulkDelete(filtered.length).catch(() => {});
    }
});

client.on('channelDelete', async (channel) => {
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry) return;

    const count = (antiNukeCache.get(entry.executor.id) || 0) + 1;
    antiNukeCache.set(entry.executor.id, count);

    if (count > 3) {
        const mem = await channel.guild.members.fetch(entry.executor.id);
        await mem.roles.set([]).catch(() => {}); 
    }
    setTimeout(() => antiNukeCache.delete(entry.executor.id), 60000);
});

// ===== 4. GLOBAL BLACK BOX LOGGING (Human Actions) =====

client.on('messageDelete', async (message) => {
    if (message.partial || message.author.bot) return;
    const logCh = getLogChannel(message.guild);
    if (!logCh) return;
    const embed = new EmbedBuilder()
        .setTitle("🗑️ Message Deleted")
        .setColor("#34495e")
        .addFields(
            { name: "Author", value: message.author.tag, inline: true },
            { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
            { name: "Content", value: message.content.slice(0, 1024) || "*(No text content)*" }
        ).setTimestamp();
    logCh.send({ embeds: [embed] }).catch(() => {});
});

client.on('guildBanAdd', async (ban) => {
    const logCh = getLogChannel(ban.guild);
    if (!logCh) return;
    const fetchedLogs = await ban.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.MemberBanAdd }).catch(() => null);
    const banLog = fetchedLogs?.entries.first();
    const embed = new EmbedBuilder()
        .setTitle("🔨 Member Banned")
        .setColor("#ff0000")
        .addFields(
            { name: "Target", value: ban.user.tag, inline: true },
            { name: "By", value: banLog ? banLog.executor.tag : "Unknown", inline: true }
        ).setTimestamp();
    logCh.send({ embeds: [embed] }).catch(() => {});
});

// ===== 5. INTERACTION COMMAND HANDLER =====
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, guild, member } = int;
    const config = db.get(guild.id);
    const isAuthorized = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.has(config?.modRole);

    if (commandName === 'setup') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return int.reply({ content: "Only Admins can run setup.", ephemeral: true });
        await int.deferReply({ ephemeral: true });
        const modRoleName = options.getString('mod_role_name') || "Security Moderator";
        const sensitivity = options.getInteger('spam_sensitivity') || 5;
        const role = await guild.roles.create({ name: modRoleName, color: '#2ecc71', reason: 'Setup' });
        const logs = await guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });
        db.set(guild.id, { modRole: role.id, logChannel: logs.id, spamLimit: sensitivity });
        return int.editReply(`✅ **Setup Complete!**\nLogs Channel: <#${logs.id}>`);
    }

    if (['kick', 'ban', 'mute', 'lockdown'].includes(commandName)) {
        if (!isAuthorized) return int.reply({ content: "❌ Access Denied.", ephemeral: true });
        const target = options.getMember('target');
        const reason = options.getString('reason') || "Violation of rules.";

        try {
            if (commandName === 'kick') await target.kick(reason);
            if (commandName === 'ban') await target.ban({ reason });
            if (commandName === 'mute') await target.timeout(options.getInteger('minutes') * 60000, reason);
            if (commandName === 'lockdown') {
                const status = options.getBoolean('status');
                await int.channel.permissionOverwrites.edit(guild.id, { SendMessages: !status });
                return int.reply(`🔒 Lockdown: **${status ? 'ON' : 'OFF'}**`);
            }
            int.reply(`✅ Action **${commandName}** completed.`);
        } catch (e) { int.reply({ content: "❌ Hierarchy error.", ephemeral: true }); }
    }
    // (Stats command follows same pattern...)
});

client.once('ready', () => {
    console.log(`🚀 ${client.user.tag} is protecting ${client.guilds.cache.size} servers.`);
});

client.login(TOKEN);
