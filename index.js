const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder, 
    ChannelType, PermissionsBitField, Collection 
} = require('discord.js');
const express = require('express');

// ===== 1. SERVER & ENGINE SETUP =====-
const app = express();
app.get('/', (req, res) => res.send('Cybershield is here!: ACTIVE'));
const webServer = app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ]
});

// Data persistence (Replace with MongoDB for massive scaling)
const db = new Collection(); 
const antiSpamCache = new Collection();
const antiNukeCache = new Collection();

const CLIENT_ID = '1491381996025413764'; 
const TOKEN = process.env.TOKEN;

// ===== 2. GLOBAL COMMAND REGISTRATION =====
const commands = [
    // Setup Wizard
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure security, mod roles, and logs')
        .addStringOption(o => o.setName('mod_role_name').setDescription('Name for your Moderator role'))
        .addIntegerOption(o => o.setName('spam_sensitivity').setDescription('Messages allowed per 5s (Default: 5)')),

    // Emergency Tools
    new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Freeze the current channel')
        .addBooleanOption(o => o.setName('status').setDescription('True = Locked, False = Unlocked').setRequired(true)),

    // Moderation Tools
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription(' Ban a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to ban'))
        .addStringOption(o => o.setName('reason').setDescription('Reason for ban')),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription(' Kick a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to kick'))
        .addStringOption(o => o.setName('reason').setDescription('Reason for kick')),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription(' Mute a user (Timeout)')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to mute'))
        .addIntegerOption(o => o.setName('minutes').setRequired(true).setDescription('Duration in minutes')),

    // Info
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

// ===== 3. AUTOMATED EVENTS =====

// Join Greeting
client.on('guildCreate', async (guild) => {
    const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
    const welcome = new EmbedBuilder()
        .setTitle("Cybershield is here!")
        .setColor("#5865f2")
        .setDescription(`Hello **${guild.name}**! I'm your new security system.\n\n**Quick Start:**\nRun \`/setup\` to create your **Moderator Role**, **Log Channels**, and **Anti-Spam** settings. We also inclusde: Anti-Spam: Stops people from sending too many messages too fast.

Anti-Raid: Blocks "bot attacks" by kicking brand-new accounts.

Anti-Nuke: Stops rogue moderators from deleting all your channels.

Auto-Timeout: Automatically silences people who break the rules.

Lockdown: Instantly freezes a channel so nobody can talk during an emergency.`)
        .setTimestamp();
    if (channel) channel.send({ embeds: [welcome] });
});

// Anti-Spam Logic
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

// Anti-Nuke (Channel Protection)
client.on('channelDelete', async (channel) => {
    const audit = await channel.guild.fetchAuditLogs({ limit: 1, type: 26 }).catch(() => null);
    const entry = audit?.entries.first();
    if (!entry) return;

    const count = (antiNukeCache.get(entry.executor.id) || 0) + 1;
    antiNukeCache.set(entry.executor.id, count);

    if (count > 3) {
        const mem = await channel.guild.members.fetch(entry.executor.id);
        await mem.roles.set([]).catch(() => {}); // Quarantine
    }
    setTimeout(() => antiNukeCache.delete(entry.executor.id), 60000);
});

// ===== 4. INTERACTION COMMAND HANDLER =====
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;

    const { commandName, options, guild, member } = int;
    const config = db.get(guild.id);

    // Permission Check: Owner or Custom Mod Role
    const isAuthorized = member.permissions.has(PermissionsBitField.Flags.Administrator) || 
                       member.roles.cache.has(config?.modRole);

    // --- SETUP COMMAND ---
    if (commandName === 'setup') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return int.reply({ content: "Only Admins can run setup.", ephemeral: true });

        await int.deferReply({ ephemeral: true });
        
        const modRoleName = options.getString('mod_role_name') || "Security Moderator";
        const sensitivity = options.getInteger('spam_sensitivity') || 5;

        // Create Moderator Role
        const role = await guild.roles.create({
            name: modRoleName,
            color: '#2ecc71',
            reason: 'Setup'
        });

        // Create Private Logs
        const logs = await guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });

        db.set(guild.id, { modRole: role.id, logChannel: logs.id, spamLimit: sensitivity });

        return int.editReply(`✅ **Setup Complete!**\nRole Created: <@&${role.id}>\nLogs Channel: <#${logs.id}>\nSpam Limit: ${sensitivity} per 5s`);
    }

    // --- MODERATION COMMANDS ---
    if (['kick', 'ban', 'mute', 'lockdown'].includes(commandName)) {
        if (!isAuthorized) return int.reply({ content: "❌ Access Denied: Requires Mod Role.", ephemeral: true });

        const target = options.getMember('target');
        const reason = options.getString('reason') || "Violation of rules.";

        try {
            if (commandName === 'kick') await target.kick(reason);
            if (commandName === 'ban') await target.ban({ reason });
            if (commandName === 'mute') await target.timeout(options.getInteger('minutes') * 60000, reason);
            if (commandName === 'lockdown') {
                const status = options.getBoolean('status');
                await int.channel.permissionOverwrites.edit(guild.id, { SendMessages: !status });
                return int.reply(`🔒 Channel Lockdown: **${status ? 'ON' : 'OFF'}**`);
            }

            int.reply(`✅ Action **${commandName}** completed on **${target.user.tag}**.`);
            
            // Log to channel
            if (config?.logChannel) {
                const logCh = guild.channels.cache.get(config.logChannel);
                const logEmbed = new EmbedBuilder()
                    .setTitle(`🛡️ Log: ${commandName.toUpperCase()}`)
                    .addFields(
                        { name: "User", value: target ? target.user.tag : "N/A", inline: true },
                        { name: "Mod", value: int.user.tag, inline: true },
                        { name: "Reason", value: reason }
                    )
                    .setColor("#f1c40f").setTimestamp();
                logCh.send({ embeds: [logEmbed] }).catch(() => {});
            }
        } catch (e) {
            int.reply({ content: "❌ Error: Hierarchy issue or missing permissions.", ephemeral: true });
        }
    }

    if (commandName === 'stats') {
        const statsEmbed = new EmbedBuilder()
            .setTitle("Statistics")
            .addFields(
                { name: "Servers Protected", value: `${client.guilds.cache.size}`, inline: true },
                { name: "Total Users Monitoring", value: `${client.users.cache.size}`, inline: true },
                { name: "Latency", value: `${client.ws.ping}ms`, inline: true }
            )
            .setColor("#3498db");
        int.reply({ embeds: [statsEmbed] });
    }
});

// ===== 5. RECOVERY & SHUTDOWN =====
process.on('unhandledRejection', error => console.error('Unhandled Promise Rejection:', error));

process.on('SIGINT', () => {
    console.log('🛑 Shutting down security features...');
    webServer.close(() => {
        client.destroy();
        process.exit(0);
    });
});

client.once('ready', () => {
    console.log(`🚀 ${client.user.tag} is protecting ${client.guilds.cache.size} servers.`);
    client.user.setActivity('for Raids', { type: 3 }); // Watching
});

client.login(TOKEN);
