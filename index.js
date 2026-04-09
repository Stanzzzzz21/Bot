const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle 
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
const WHITELIST = ['876731494805155851']; // Your ID

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
    } catch (e) { console.error("Log error: Check bot channel permissions."); }
}

// --- COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Link Admin/Verified roles and create logs')
        .addRoleOption(o => o.setName('admin').setRequired(true).setDescription('The role allowed to use this bot'))
        .addRoleOption(o => o.setName('verified').setRequired(true).setDescription('The role given after clicking verify')),
    
    new SlashCommandBuilder().setName('verify-panel').setDescription('Deploy the verification button'),

    new SlashCommandBuilder().setName('role').setDescription('Manage user roles')
        .addSubcommand(s => s.setName('add').setDescription('Give a role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('Remove a role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true))),

    new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages (skips messages >14 days old)')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Messages to clear (1-100)')),

    new SlashCommandBuilder().setName('settings').setDescription('Check security status')
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (int.isButton() && int.customId === 'verify_user') {
        const config = db.get(int.guildId);
        if (!config?.verifiedRole) return int.reply({ content: "❌ Verify role not set up. Run `/setup`.", ephemeral: true });
        const role = int.guild.roles.cache.get(config.verifiedRole);
        if (!role) return int.reply({ content: "❌ Role no longer exists.", ephemeral: true });
        if (int.member.roles.cache.has(role.id)) return int.reply({ content: "✅ Already verified!", ephemeral: true });
        await int.member.roles.add(role).catch(() => null);
        return int.reply({ content: "✅ Verification complete!", ephemeral: true });
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
        return int.editReply(`✅ Done! Admin: <@&${config.adminRole}> | Logs: <#${config.logChannel}>`);
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("❌ Access Denied.");

    try {
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            const deleted = await int.channel.bulkDelete(Math.min(amt, 100), true);
            await sendLog(int.guild, { title: "Purge", msg: `${int.user.tag} cleared ${deleted.size} msgs in ${int.channel.name}`, color: 0x3498db });
            return int.editReply(`✅ Cleared ${deleted.size} messages.`);
        }
        if (int.commandName === 'role') {
            const target = int.options.getMember('user');
            const role = int.options.getRole('role');
            if (int.options.getSubcommand() === 'add') await target.roles.add(role);
            else await target.roles.remove(role);
            return int.editReply(`✅ Role ${role.name} updated for ${target.user.tag}`);
        }
        if (int.commandName === 'verify-panel') {
            const embed = new EmbedBuilder().setTitle('🛡️ Security Verification').setDescription('Click below to gain access.').setColor(0x5865f2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_user').setLabel('Verify').setStyle(ButtonStyle.Success));
            await int.channel.send({ embeds: [embed], components: [row] });
            return int.editReply("Panel deployed.");
        }
    } catch (e) { return int.editReply("❌ Error: Check bot role hierarchy."); }
});

// --- ANTI-NUKE ---
client.on('channelDelete', async (ch) => {
    const config = db.get(ch.guild?.id) || DEFAULT_CONFIG;
    if (!ch.guild || !config.antiNuke) return;
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const exec = logs?.entries.first()?.executor;
    if (exec?.id === client.user.id || (exec && WHITELIST.includes(exec.id))) return;
    await ch.guild.channels.create({ name: ch.name, type: ch.type, parent: ch.parentId, permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny })) }).catch(() => null);
    await sendLog(ch.guild, { title: "Anti-Nuke", msg: `Restored channel ${ch.name}. Deleted by ${exec?.tag || "Unknown"}`, color: 0xff0000 });
});

// --- FILTERS ---
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        await msg.delete().catch(() => null);
        return sendLog(msg.guild, { title: "Invite Blocked", msg: `Link from ${msg.author.tag} removed.`, color: 0xf1c40f });
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands }).catch(console.error);
    console.log(`🛡️ ${client.user.tag} Online`);
});

client.login(process.env.TOKEN);
