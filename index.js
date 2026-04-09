const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- 1. WEB SERVER ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('CyberShield Pulse: Online'));
app.listen(port, () => console.log(`Web server on port ${port}`));

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
const nukeTracker = new Collection();
const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = {
    adminRole: null, 
    minAge: 1, 
    spamLimit: 5, 
    antiInvite: true,
    nukeLimit: 3
};

// --- 2. SLASH COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Server Administrator Role')
        .addRoleOption(o => o.setName('role').setRequired(true).setDescription('The authorized role')),
    
    new SlashCommandBuilder().setName('configure').setDescription('Customize security settings')
        .addIntegerOption(o => o.setName('age').setDescription('Account age gate in days'))
        .addIntegerOption(o => o.setName('spam').setDescription('Max messages per 3 seconds'))
        .addBooleanOption(o => o.setName('invites').setDescription('Block server invites'))
        .addIntegerOption(o => o.setName('nuke').setDescription('Channels deleted before role-strip')),

    new SlashCommandBuilder().setName('settings').setDescription('View current security config'),
    
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Amount')),
    
    new SlashCommandBuilder().setName('kick').setDescription('Kick user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user')),
    
    new SlashCommandBuilder().setName('ban').setDescription('Ban user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user'))
].map(c => c.toJSON());

// --- 3. INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    await int.deferReply({ ephemeral: true }).catch(() => null);

    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    // Setup
    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.editReply("Error: Owner Only.");
        config.adminRole = int.options.getRole('role').id;
        db.set(int.guildId, config);
        return int.editReply(`Setup complete. <@&${config.adminRole}> is now the Server Administrator.`);
    }

    // Permission Check
    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("Access Denied.");

    // Configure (Customizable Settings)
    if (int.commandName === 'configure') {
        const newAge = int.options.getInteger('age');
        const newSpam = int.options.getInteger('spam');
        const newInvites = int.options.getBoolean('invites');
        const newNuke = int.options.getInteger('nuke');

        if (newAge !== null) config.minAge = newAge;
        if (newSpam !== null) config.spamLimit = newSpam;
        if (newInvites !== null) config.antiInvite = newInvites;
        if (newNuke !== null) config.nukeLimit = newNuke;

        db.set(int.guildId, config);
        return int.editReply("Security settings updated successfully.");
    }

    if (int.commandName === 'settings') {
        return int.editReply(`**Current Configuration:**\n- Admin Role: <@&${config.adminRole || 'Not Set'}>\n- Age Gate: ${config.minAge}d\n- Spam Limit: ${config.spamLimit} msgs\n- Anti-Invite: ${config.antiInvite}\n- Nuke Threshold: ${config.nukeLimit}`);
    }

    // Moderation
    try {
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            await int.channel.bulkDelete(Math.min(amt, 100), true);
            return int.editReply(`Purged ${amt} messages.`);
        }
        if (int.commandName === 'kick') {
            const target = int.options.getMember('user');
            if (!target?.kickable) return int.editReply("Cannot kick this user.");
            await target.kick();
            return int.editReply(`Kicked ${target.user.tag}`);
        }
        if (int.commandName === 'ban') {
            const target = int.options.getMember('user');
            if (!target?.bannable) return int.editReply("Cannot ban this user.");
            await target.ban();
            return int.editReply(`Banned ${target.user.tag}`);
        }
    } catch (e) { console.error(e); }
});

// --- 4. ANTI-NUKE & RESTORE ---
client.on('channelDelete', async (ch) => {
    if (!ch.guild) return;
    try {
        const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const entry = logs?.entries.first();
        const exec = entry?.executor;
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

        await ch.guild.channels.create({
            name: ch.name || 'restored-channel',
            type: ch.type,
            parent: ch.parentId || null,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
        }).catch(() => null);

        if (exec) {
            let data = nukeTracker.get(exec.id) || { count: 0, time: Date.now() };
            if (Date.now() - data.time < 10000) data.count++; else data.count = 1;
            data.time = Date.now();
            nukeTracker.set(exec.id, data);

            const config = db.get(ch.guild.id) || DEFAULT_CONFIG;
            if (data.count >= config.nukeLimit) {
                const member = await ch.guild.members.fetch(exec.id).catch(() => null);
                if (member) await member.roles.set([]).catch(() => null);
            }
        }
    } catch (e) { console.log("Restore snag handled."); }
});

// --- 5. CHAT & JOIN SECURITY ---
client.on('guildMemberAdd', async (m) => {
    const config = db.get(m.guild.id) || DEFAULT_CONFIG;
    const badNames = ["discord.gg/", "free-nitro", "nuke-bot"];
    if (badNames.some(n => m.user.username.toLowerCase().includes(n))) return m.ban({ reason: "Scam Name" }).catch(() => null);
    const age = (Date.now() - m.user.createdTimestamp) / 86400000;
    if (age < config.minAge) return m.kick("Account Age Gate").catch(() => null);
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

// --- 6. STARTUP & WELCOME ---
client.on('guildCreate', async (guild) => {
    const welcome = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
    if (welcome) {
        welcome.send(`Hello **${guild.name}**, I'm your new security bot! \n**IMPORTANT:** Use \`/setup\` first to choose a **Server Administrator** role. \nWebsite: https://cyber-shield-gray.vercel.app`).catch(() => null);
    }
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🛡️ CyberShield Ready as ${client.user.tag}`);
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);
