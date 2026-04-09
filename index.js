const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- 1. ROBUST KEEP-ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('CyberShield is Pulse-Active 🛡️'));

// Start Express first so Render sees the port is active immediately
app.listen(port, () => console.log(`🚀 Web server active on port ${port}`));

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
let joinTracker = [];

const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = {
    managerRole: null, logs: null, minAge: 1, spamLimit: 5, nukeLimit: 3, antiInvite: true, joinLimit: 5
};

const isAuth = (int, config) => {
    if (!int.guild) return false;
    if (int.user.id === int.guild.ownerId) return true;
    if (WHITELIST.includes(int.user.id)) return true;
    if (config.managerRole && int.member.roles.cache.has(config.managerRole)) return true;
    return false;
};

// --- 2. COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Manager Role').addRoleOption(o => o.setName('role').setRequired(true).setDescription('Role to manage bot')),
    new SlashCommandBuilder().setName('configure').setDescription('Adjust security').addIntegerOption(o => o.setName('age').setDescription('Min days')).addIntegerOption(o => o.setName('spam').setDescription('Max msg/3s')).addBooleanOption(o => o.setName('invites').setDescription('Block Invites')),
    new SlashCommandBuilder().setName('settings').setDescription('View current security'),
    new SlashCommandBuilder().setName('audit').setDescription('Risk scan'),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('target').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('target').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages').addIntegerOption(o => o.setName('amount').setRequired(true)),
    new SlashCommandBuilder().setName('role').setDescription('Toggle role').addUserOption(o => o.setName('user').setRequired(true)).addRoleOption(o => o.setName('role').setRequired(true))
].map(c => c.toJSON());

// --- 3. EVENT HANDLERS ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guildId) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "❌ Owner only.", ephemeral: true });
        const role = int.options.getRole('role');
        config.managerRole = role.id;
        
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({ 
            name: 'shield-logs', type: ChannelType.GuildText, 
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] 
        }).catch(() => null);

        config.logs = logCh?.id || null;
        db.set(int.guildId, config);
        return int.reply({ content: `✅ Setup complete. <@&${role.id}> can now manage the bot.`, ephemeral: true });
    }

    if (!isAuth(int, config)) return int.reply({ content: "❌ No permission.", ephemeral: true });

    // Mod Logic
    try {
        if (int.commandName === 'kick') {
            const target = int.options.getMember('target');
            if (!target?.kickable) return int.reply("❌ Cannot kick this user.");
            await target.kick();
            return int.reply(`👞 Kicked **${target.user.tag}**`);
        }
        if (int.commandName === 'ban') {
            const target = int.options.getMember('target');
            if (!target?.bannable) return int.reply("❌ Cannot ban this user.");
            await target.ban();
            return int.reply(`🔨 Banned **${target.user.tag}**`);
        }
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            await int.channel.bulkDelete(Math.min(amt, 100), true);
            return int.reply({ content: `🧹 Purged messages.`, ephemeral: true });
        }
        if (int.commandName === 'role') {
            const member = int.options.getMember('user');
            const role = int.options.getRole('role');
            if (member.roles.cache.has(role.id)) await member.roles.remove(role);
            else await member.roles.add(role);
            return int.reply(`✅ Updated roles for ${member.user.tag}`);
        }
    } catch (e) { console.error("Mod Command Error:", e); }
});

// Security Listeners
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
});

// Restore Logic
client.on('channelDelete', async (ch) => {
    try {
        const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const exec = logs?.entries.first()?.executor;
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;
        await ch.guild.channels.create({
            name: ch.name, type: ch.type, parent: ch.parentId,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
        });
    } catch (e) { console.log("Restore Fail"); }
});

// --- 4. STARTUP ---
client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🛡️ CyberShield Online as ${client.user.tag}`);
    } catch (err) { console.error("Ready Error:", err); }
});

// Final check for the token to prevent Status 1 crash
if (!process.env.TOKEN) {
    console.error("❌ ERROR: TOKEN is missing in Environment Variables!");
    process.exit(1);
}

client.login(process.env.TOKEN).catch(err => {
    console.error("❌ Login Failed:", err.message);
    process.exit(1); 
});
