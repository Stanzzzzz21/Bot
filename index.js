const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- 1. WEB SERVER & KEEP-ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('CyberShield Pulse: Active 🟢'));
app.listen(port, () => console.log(`Web server listening on port ${port}`));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration 
    ] 
});

// Databases & Trackers
const db = new Collection(); 
const msgTracker = new Collection();
const nukeTracker = new Collection();
const WHITELIST = ['876731494805155851']; // Your Master ID

const DEFAULT_CONFIG = {
    managerRole: null, 
    minAge: 1, 
    spamLimit: 5, 
    antiInvite: true,
    nukeLimit: 3
};

// --- 2. SLASH COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup Manager Role')
        .addRoleOption(o => o.setName('role').setRequired(true).setDescription('Authorized role')),
    new SlashCommandBuilder().setName('settings').setDescription('View current security config'),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Amount (max 100)')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user')),
    new SlashCommandBuilder().setName('role').setDescription('Toggle role')
        .addUserOption(o => o.setName('user').setRequired(true).setDescription('Target user'))
        .addRoleOption(o => o.setName('targetrole').setRequired(true).setDescription('Role to toggle'))
].map(c => c.toJSON());

// --- 3. INTERACTION HANDLER (Anti-Crash Deferral) ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;

    // Await the reply so Render has time to process without "did not respond" error
    await int.deferReply({ ephemeral: true }).catch(() => null);

    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    // Setup Command
    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) {
            return int.editReply("Error: Owner Only.");
        }
        config.managerRole = int.options.getRole('role').id;
        db.set(int.guildId, config);
        return int.editReply(`Setup complete. <@&${config.managerRole}> is now authorized.`);
    }

    // Auth Check for Mod Commands
    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.managerRole && int.member.roles.cache.has(config.managerRole));
    if (!isAuth) return int.editReply("Access Denied.");

    try {
        if (int.commandName === 'settings') {
            return int.editReply(`**CyberShield Settings:**\n- Min Age: ${config.minAge}d\n- Manager Role: <@&${config.managerRole || 'None'}>\n- Anti-Invite: ${config.antiInvite}\n- Spam Limit: ${config.spamLimit} msgs`);
        }
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
        if (int.commandName === 'role') {
            const member = int.options.getMember('user');
            const role = int.options.getRole('targetrole');
            if (member.roles.cache.has(role.id)) await member.roles.remove(role);
            else await member.roles.add(role);
            return int.editReply(`Updated roles for ${member.user.tag}`);
        }
    } catch (e) { 
        console.error(e);
        return int.editReply("Internal Error.");
    }
});

// --- 4. ANTI-NUKE & AUTO-RESTORE LOGIC ---
client.on('channelDelete', async (ch) => {
    if (!ch.guild) return;
    try {
        const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const entry = logs?.entries.first();
        const exec = entry?.executor;

        // Ignore if deleted by Owner or Whitelist
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

        // Immediate Restoration
        await ch.guild.channels.create({
            name: ch.name || 'restored-channel',
            type: ch.type,
            parent: ch.parentId || null,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({
                id: p.id, allow: p.allow, deny: p.deny
            }))
        }).catch(() => null);

        // Punishment for Rogue Admin
        if (exec) {
            let data = nukeTracker.get(exec.id) || { count: 0, time: Date.now() };
            if (Date.now() - data.time < 10000) data.count++;
            else data.count = 1;
            data.time = Date.now();
            nukeTracker.set(exec.id, data);

            if (data.count >= 3) {
                const member = await ch.guild.members.fetch(exec.id).catch(() => null);
                if (member) await member.roles.set([]).catch(() => null); // Strips all roles
            }
        }
    } catch (e) { console.log("Anti-Nuke Recovery handled."); }
});

// --- 5. JOIN PROTECTION (Age Gate & Scam Filter) ---
client.on('guildMemberAdd', async (m) => {
    const config = db.get(m.guild.id) || DEFAULT_CONFIG;
    
    // Scam Username Check
    const badTerms = ["discord.gg/", "free-nitro", "nuke-bot", "nitro-gift"];
    if (badTerms.some(term => m.user.username.toLowerCase().includes(term))) {
        return m.ban({ reason: "CyberShield: Scam Name Filter" }).catch(() => null);
    }

    // Age Gate
    const accountAge = (Date.now() - m.user.createdTimestamp) / 86400000;
    if (accountAge < config.minAge) return m.kick("CyberShield: Account Age Gate").catch(() => null);
});

// --- 6. CHAT DEFENSE (Spam, Mentions, Invites) ---
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    // Mass Mention (@everyone or 5+ users)
    if (msg.mentions.users.size > 5 || msg.content.includes('@everyone')) {
        await msg.delete().catch(() => null);
        return msg.member.timeout(3600000, "CyberShield: Mass Mention").catch(() => null);
    }

    // Anti-Invite
    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        return msg.delete().catch(() => null);
    }

    // Spam Tracker
    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++;
    else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(600000, "CyberShield: Spamming").catch(() => null);
    }
});

// --- 7. WELCOME & STARTUP ---
client.on('guildCreate', async (guild) => {
    const welcomeCh = guild.systemChannel || guild.channels.cache.find(c => 
        c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
    );
    if (welcomeCh) {
        welcomeCh.send(`Hello **${guild.name}**, I'm your new security bot! \n**IMPORTANT:** Use \`/setup\` and \`/settings\` to configure me. Only the owner can run \`/setup\`. Once done, you can choose a role to manage the rest. \nCheck us out: https://cyber-shield-gray.vercel.app`).catch(() => null);
    }
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log(`🛡️ CyberShield Online: ${client.user.tag}`);
    } catch (e) { console.error("Command registration failed:", e); }
});

client.login(process.env.TOKEN);
