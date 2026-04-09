const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- KEEP ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('CyberShield is Online'));
app.listen(port, () => console.log(`Keep-Alive Active on ${port}`));

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
    managerRole: null, logs: null, minAge: 1, spamLimit: 5, antiInvite: true
};

const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Manager Role').addRoleOption(o => o.setName('role').setRequired(true).setDescription('Role to manage bot')),
    new SlashCommandBuilder().setName('settings').setDescription('View current security'),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages').addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('role').setDescription('Toggle role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true))
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "Error: Owner only.", ephemeral: true });
        config.managerRole = int.options.getRole('role').id;
        db.set(int.guildId, config);
        return int.reply({ content: `Setup complete. Role <@&${config.managerRole}> can now manage the bot.`, ephemeral: true });
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.managerRole && int.member.roles.cache.has(config.managerRole));
    if (!isAuth) return int.reply({ content: "Access Denied.", ephemeral: true });

    try {
        if (int.commandName === 'kick') {
            const target = int.options.getMember('target');
            if (!target?.kickable) return int.reply("Cannot kick this user.");
            await target.kick();
            return int.reply(`Kicked ${target.user.tag}`);
        }
        if (int.commandName === 'ban') {
            const target = int.options.getMember('target');
            if (!target?.bannable) return int.reply("Cannot ban this user.");
            await target.ban();
            return int.reply(`Banned ${target.user.tag}`);
        }
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            await int.channel.bulkDelete(Math.min(amt, 100), true);
            return int.reply({ content: `Purged ${amt} messages.`, ephemeral: true });
        }
        if (int.commandName === 'role') {
            const member = int.options.getMember('user');
            const role = int.options.getRole('role');
            if (member.roles.cache.has(role.id)) await member.roles.remove(role);
            else await member.roles.add(role);
            return int.reply(`Updated roles for ${member.user.tag}`);
        }
    } catch (e) { console.error("Command Error:", e); }
});

// --- SAFE AUTO-RESTORE ---
client.on('channelDelete', async (ch) => {
    if (!ch.guild) return;
    try {
        const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const exec = logs?.entries.first()?.executor;
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

        // Recreating with fallback values to prevent Shapeshift/Status 1 errors
        await ch.guild.channels.create({
            name: ch.name || 'restored-channel',
            type: ch.type,
            parent: ch.parentId || null,
            topic: ch.topic || null,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({
                id: p.id,
                allow: p.allow || [],
                deny: p.deny || []
            }))
        }).catch(() => console.log("Restore failed - missing permissions"));
    } catch (e) { console.log("Restore snag handled."); }
});

// --- SECURITY LOGIC ---
client.on('guildMemberAdd', async (m) => {
    const config = db.get(m.guild.id) || DEFAULT_CONFIG;
    const badNames = ["discord.gg/", "free-nitro", "nuke-bot"];
    if (badNames.some(n => m.user.username.toLowerCase().includes(n))) return m.ban({ reason: "Scam Name" }).catch(() => null);
    const age = (Date.now() - m.user.createdTimestamp) / 86400000;
    if (age < config.minAge) return m.kick("Age Gate").catch(() => null);
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    if (msg.mentions.users.size > 5 || msg.content.includes('@everyone')) {
        await msg.delete().catch(() => null);
        return msg.member.timeout(3600000).catch(() => null);
    }
    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) return msg.delete().catch(() => null);
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`CyberShield Online: ${client.user.tag}`);
    } catch (e) { console.error("Registration Error"); }
});

client.login(process.env.TOKEN).catch(e => console.error("Login failed: Check TOKEN."));
