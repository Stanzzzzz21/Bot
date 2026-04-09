const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const express = require('express');

// --- 1. WEB SERVER (For 24/7 Hosting) ---
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

const DEFAULT_CONFIG = { 
    adminRole: null, logChannel: null, verifiedRole: null,
    minAge: 3, spamLimit: 5, antiInvite: true, 
    antiMention: true, antiNuke: true, timeoutMinutes: 10 
};

// --- HELPER: LOGGING ---
async function sendLog(guild, { title, msg, color = 0x2b2d31 }) {
    try {
        const config = db.get(guild.id) || DEFAULT_CONFIG;
        if (!config.logChannel) return;
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(`🛡️ ${title}`).setDescription(msg).setColor(color).setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) { console.error("Log error handled."); }
}

// --- COMMANDS (FIXED FOR SHAPESHIFT VALIDATION) ---
// Note: All names MUST be lowercase, no spaces. Descriptions MUST be 1-100 chars.
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('configure the admin role and logging channel')
        .addRoleOption(o => o.setName('admin').setRequired(true).setDescription('role for moderators'))
        .addRoleOption(o => o.setName('verified').setRequired(true).setDescription('role for verified users')),
    
    new SlashCommandBuilder()
        .setName('verify-panel')
        .setDescription('deploy the verification button panel'),

    new SlashCommandBuilder()
        .setName('role')
        .setDescription('manage member roles')
        .addSubcommand(s => s.setName('add').setDescription('assign a role to a member').addUserOption(o => o.setName('user').setRequired(true).setDescription('the user')).addRoleOption(o => o.setName('role').setRequired(true).setDescription('the role')))
        .addSubcommand(s => s.setName('remove').setDescription('remove a role from a member').addUserOption(o => o.setName('user').setRequired(true).setDescription('the user')).addRoleOption(o => o.setName('role').setRequired(true).setDescription('the role'))),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('clear a specific amount of messages')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('number of messages')),

    new SlashCommandBuilder()
        .setName('settings')
        .setDescription('view the current security settings')
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (int.isButton() && int.customId === 'verify_user') {
        const config = db.get(int.guildId);
        if (!config?.verifiedRole) return int.reply({ content: "❌ Not set up.", ephemeral: true });
        const role = int.guild.roles.cache.get(config.verifiedRole);
        if (!role) return int.reply({ content: "❌ Role missing.", ephemeral: true });
        await int.member.roles.add(role).catch(() => null);
        return int.reply({ content: "✅ Verified!", ephemeral: true });
    }

    if (!int.isChatInputCommand() || !int.guild) return;
    await int.deferReply({ ephemeral: true }).catch(() => null);
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.editReply("❌ Owner Only.");
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
        config.adminRole = int.options.getRole('admin').id;
        config.verifiedRole = int.options.getRole('verified').id;
        config.logChannel = logCh?.id || null;
        db.set(int.guildId, config);
        return int.editReply(`✅ Setup Saved.`);
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("❌ Access Denied.");

    try {
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            const deleted = await int.channel.bulkDelete(Math.min(amt, 100), true);
            return int.editReply(`✅ Cleared ${deleted.size} messages.`);
        }
        if (int.commandName === 'role') {
            const target = int.options.getMember('user');
            const role = int.options.getRole('role');
            if (int.options.getSubcommand() === 'add') await target.roles.add(role);
            else await target.roles.remove(role);
            return int.editReply(`✅ Role updated.`);
        }
        if (int.commandName === 'verify-panel') {
            const embed = new EmbedBuilder().setTitle('🛡️ Verification').setDescription('Click to verify.').setColor(0x5865f2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify').setStyle(ButtonStyle.Success));
            await int.channel.send({ embeds: [embed], components: [row] });
            return int.editReply("Panel Deployed.");
        }
    } catch (e) { return int.editReply("❌ Permission Error."); }
});

// --- ANTI-NUKE ---
client.on('channelDelete', async (ch) => {
    const config = db.get(ch.guild?.id) || DEFAULT_CONFIG;
    if (!ch.guild || !config.antiNuke) return;
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const exec = logs?.entries.first()?.executor;
    if (exec?.id === client.user.id || (exec && WHITELIST.includes(exec.id))) return;
    await ch.guild.channels.create({ name: ch.name, type: ch.type, parent: ch.parentId, permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny })) }).catch(() => null);
    await sendLog(ch.guild, { title: "Anti-Nuke", msg: `Restored ${ch.name}`, color: 0xff0000 });
});

// --- READY EVENT ---
client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🛡️ ${client.user.tag} Online`);
    } catch (error) {
        console.error("Shapeshift Error caught during registration:", error);
    }
});

// --- CRITICAL: ANTI-CRASH HANDLERS ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

client.login(process.env.TOKEN);
