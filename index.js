const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, Partials, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// ===== 1. CORE ENGINE =====
const app = express();
app.get('/', (req, res) => res.send('Cybershield: ULTIMATE EDITION 🛡️'));
app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const db = new Collection(); 
const antiSpamCache = new Collection();
const CLIENT_ID = '1491381996025413764'; 
const TOKEN = process.env.TOKEN;

// Smart Channel Recovery
const getLogChannel = (guild) => {
    const config = db.get(guild.id);
    return guild.channels.cache.get(config?.logChannel) || 
           guild.channels.cache.find(c => c.name === 'shield-logs' && c.type === ChannelType.GuildText);
};

// ===== 2. SLASH COMMANDS =====
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Auto-build security & staff roles')
        .addStringOption(o => o.setName('mod_role').setDescription('Name for your Moderator role'))
        .addIntegerOption(o => o.setName('limit').setDescription('Spam limit (Default: 5)')),
    new SlashCommandBuilder().setName('lockdown').setDescription('Freeze/Unfreeze the current channel')
        .addBooleanOption(o => o.setName('status').setRequired(true).setDescription('True = Locked')),
    new SlashCommandBuilder().setName('mute').setDescription('Silence a rule-breaker')
        .addUserOption(o => o.setName('target').setRequired(true))
        .addIntegerOption(o => o.setName('mins').setRequired(true)),
    new SlashCommandBuilder().setName('stats').setDescription('Check bot health & server count')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
    try { await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands }); } 
    catch (e) { console.error("Sync Failure:", e); }
})();

// ===== 3. AUTO-PROTECTION (Links & Spam) =====
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const config = db.get(msg.guild.id);
    const isStaff = msg.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || 
                    (config?.modRole && msg.member.roles.cache.has(config.modRole));
    
    // Anti-Link (No ads for non-staff)
    if (msg.content.includes('discord.gg/') && !isStaff) {
        return msg.delete().catch(() => {});
    }

    // Anti-Spam Logic
    const limit = config?.spamLimit || 5;
    const now = Date.now();
    const timestamps = antiSpamCache.get(msg.author.id) || [];
    timestamps.push(now);
    const filtered = timestamps.filter(t => now - t < 5000);
    antiSpamCache.set(msg.author.id, filtered);

    if (filtered.length > limit && msg.member.moderatable) {
        await msg.member.timeout(600000, "Automated Anti-Spam").catch(() => {});
        await msg.channel.bulkDelete(filtered.length).catch(() => {});
    }
});

// ===== 4. ENHANCED LOGGING (Ghost Pings) =====
client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    
    const logCh = getLogChannel(message.guild);
    if (!logCh) return;

    const embed = new EmbedBuilder()
        .setTitle(message.mentions.users.size > 0 ? "🚨 Ghost Ping Alert" : "🗑️ Message Deleted")
        .setColor(message.mentions.users.size > 0 ? "#ff4757" : "#2f3136")
        .addFields(
            { name: "User", value: `${message.author?.tag || 'Unknown'}`, inline: true },
            { name: "Channel", value: `<#${message.channel.id}>`, inline: true },
            { name: "Content", value: message.content?.slice(0, 1000) || "*(None/Media)*" }
        ).setTimestamp();

    logCh.send({ embeds: [embed] }).catch(() => {});
});

// ===== 5. COMMAND HANDLER =====
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    const { commandName, options, guild, member } = int;
    const config = db.get(guild.id);
    const isAuthorized = member.permissions.has(PermissionsBitField.Flags.Administrator) || 
                       (config?.modRole && member.roles.cache.has(config.modRole));

    if (commandName === 'setup') {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) 
            return int.reply({ content: "❌ Admins only.", ephemeral: true });

        await int.deferReply({ ephemeral: true });

        try {
            const roleName = options.getString('mod_role') || "Moderator";
            const role = await guild.roles.create({ name: roleName, color: '#00ff99', reason: 'Bot Setup' });
            
            const logs = await guild.channels.create({
                name: 'shield-logs',
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });

            db.set(guild.id, { modRole: role.id, logChannel: logs.id, spamLimit: options.getInteger('limit') || 5 });
            
            const embed = new EmbedBuilder()
                .setTitle("🛡️ System Online")
                .setColor("#00ff99")
                .setDescription(`The server is now protected.\n\n**Mod Role:** <@&${role.id}>\n**Logs:** <#${logs.id}>`);
            
            return int.editReply({ embeds: [embed] });
        } catch (err) {
            console.error(err);
            return int.editReply("❌ Setup failed. Ensure I have 'Manage Roles' permissions.");
        }
    }

    if (commandName === 'lockdown') {
        if (!isAuthorized) return int.reply({ content: "❌ No permission.", ephemeral: true });
        const status = options.getBoolean('status');
        await int.channel.permissionOverwrites.edit(guild.id, { SendMessages: !status });
        return int.reply(`🔒 Lockdown is **${status ? 'ON' : 'OFF'}** for this channel.`);
    }

    if (commandName === 'mute') {
        if (!isAuthorized) return int.reply({ content: "❌ No permission.", ephemeral: true });
        const target = options.getMember('target');
        
        if (!target.moderatable) return int.reply({ content: "❌ I cannot mute this user.", ephemeral: true });
        
        await target.timeout(options.getInteger('mins') * 60000, "Staff command");
        return int.reply(`✅ **${target.user.tag}** muted for ${options.getInteger('mins')} minutes.`);
    }

    if (commandName === 'stats') {
        const embed = new EmbedBuilder()
            .setTitle("📊 System Health")
            .setColor("#3498db")
            .addFields(
                { name: "Active Protection", value: `${client.guilds.cache.size} Servers`, inline: true },
                { name: "Ping", value: `${client.ws.ping}ms`, inline: true }
            );
        return int.reply({ embeds: [embed] });
    }
});

// Anti-Crash Listeners
client.on('error', console.error);
process.on('unhandledRejection', console.error);

client.once('ready', () => console.log(`🚀 ${client.user.tag} IS FULLY OPERATIONAL`));
client.login(TOKEN);
