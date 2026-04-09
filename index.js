const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('CyberShield Active'));
app.listen(port, () => console.log(`Web server on ${port}`));

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
const WHITELIST = ['876731494805155851']; 
const DEFAULT_CONFIG = { managerRole: null, logs: null, minAge: 1, spamLimit: 5, antiInvite: true };

// --- FIXED COMMANDS (NO SPACES/CAPS IN NAMES) ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Manager Role')
        .addRoleOption(o => o.setName('role').setRequired(true).setDescription('Role to manage bot')),
    
    new SlashCommandBuilder().setName('settings').setDescription('View current security'),
    
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Messages to clear')),
    
    new SlashCommandBuilder().setName('kick').setDescription('Kick user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('User to kick')),
    
    new SlashCommandBuilder().setName('ban').setDescription('Ban user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('User to ban')),
    
    new SlashCommandBuilder().setName('role').setDescription('Toggle role')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user'))
        .addRoleOption(o => o.setName('targetrole').setRequired(true).setDescription('Role to toggle'))
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "Error: Owner only.", ephemeral: true });
        config.managerRole = int.options.getRole('role').id;
        db.set(int.guildId, config);
        return int.reply({ content: `Setup complete. Role <@&${config.managerRole}> is now the manager.`, ephemeral: true });
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.managerRole && int.member.roles.cache.has(config.managerRole));
    if (!isAuth) return int.reply({ content: "Access Denied.", ephemeral: true });

    try {
        if (int.commandName === 'kick') {
            const target = int.options.getMember('user');
            if (!target?.kickable) return int.reply("Cannot kick this user.");
            await target.kick();
            return int.reply(`Kicked ${target.user.tag}`);
        }
        if (int.commandName === 'ban') {
            const target = int.options.getMember('user');
            if (!target?.bannable) return int.reply("Cannot ban this user.");
            await target.ban();
            return int.reply(`Banned ${target.user.tag}`);
        }
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            await int.channel.bulkDelete(Math.min(amt, 100), true).catch(() => null);
            return int.reply({ content: `Purged ${amt} messages.`, ephemeral: true });
        }
    } catch (e) { console.error(e); }
});

// --- RESTORE LOGIC ---
client.on('channelDelete', async (ch) => {
    if (!ch.guild) return;
    try {
        const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const exec = logs?.entries.first()?.executor;
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

        await ch.guild.channels.create({
            name: ch.name || 'restored-channel',
            type: ch.type,
            parent: ch.parentId || null,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({
                id: p.id, allow: p.allow, deny: p.deny
            }))
        }).catch(() => null);
    } catch (e) { console.log("Restore failed."); }
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🛡️ CyberShield Online: ${client.user.tag}`);
    } catch (e) { console.error("Update Error:", e); }
});

client.login(process.env.TOKEN).catch(() => console.error("Login Failed. Check Token."));
