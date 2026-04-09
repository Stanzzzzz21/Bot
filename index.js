const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- KEEP ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('CyberShield is online '));
app.listen(port, () => console.log(`Keep-Alive running on ${port}`));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration // Essential for Audit Logs & Moderation
    ] 
});

const db = new Collection(); 
const nukeTracker = new Collection();
const msgTracker = new Collection();
let joinTracker = [];

const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = {
    managerRole: null,
    logs: null,
    minAge: 1,
    spamLimit: 5,
    nukeLimit: 3,
    antiInvite: true,
    joinLimit: 5
};

// Auth Check
const isAuth = (int, config) => {
    if (int.user.id === int.guild.ownerId) return true;
    if (WHITELIST.includes(int.user.id)) return true;
    if (config.managerRole && int.member.roles.cache.has(config.managerRole)) return true;
    return false;
};

// --- COMMANDS ---
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

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "❌ Owner only.", ephemeral: true });
        const role = int.options.getRole('role');
        config.managerRole = role.id;
        
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs');
        if (!logCh) {
            logCh = await int.guild.channels.create({ 
                name: 'shield-logs', 
                type: ChannelType.GuildText, 
                permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] 
            });
        }
        config.logs = logCh.id;
        db.set(int.guildId, config);
        return int.reply({ content: `✅ Setup complete. <@&${role.id}> can now manage the bot.`, ephemeral: true });
    }

    if (!isAuth(int, config)) return int.reply({ content: "❌ No permission.", ephemeral: true });

    if (int.commandName === 'kick') {
        const target = int.options.getMember('target');
        if (!target || !target.kickable) return int.reply("❌ Cannot kick this user.");
        await target.kick();
        return int.reply(` Kicked **${target.user.tag}**`);
    }

    if (int.commandName === 'ban') {
        const target = int.options.getMember('target');
        if (!target || !target.bannable) return int.reply("❌ Cannot ban this user.");
        await target.ban();
        return int.reply(` Banned **${target.user.tag}**`);
    }

    if (int.commandName === 'purge') {
        const amt = int.options.getInteger('amount');
        await int.channel.bulkDelete(Math.min(amt, 100), true).catch(() => null);
        return int.reply({ content: `Purged messages.`, ephemeral: true });
    }

    if (int.commandName === 'role') {
        const member = int.options.getMember('user');
        const role = int.options.getRole('role');
        if (member.roles.cache.has(role.id)) await member.roles.remove(role);
        else await member.roles.add(role);
        return int.reply(`✅ Updated roles for ${member.user.tag}`);
    }
});

// --- SECURITY LOGIC ---

client.on('guildMemberAdd', async (member) => {
    const config = db.get(member.guild.id) || DEFAULT_CONFIG;
    const now = Date.now();
    
    const badNames = ["discord.gg/", "free-nitro", "nuke-bot"];
    if (badNames.some(n => member.user.username.toLowerCase().includes(n))) return member.ban({ reason: "Scam Name" }).catch(() => null);

    const age = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (age < config.minAge) return member.kick("Age Gate").catch(() => null);

    joinTracker.push(now);
    joinTracker = joinTracker.filter(t => t > now - 10000);
    if (joinTracker.length > config.joinLimit) return member.kick("Raid Protection").catch(() => null);
});

client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    if (msg.mentions.users.size > 5 || msg.content.includes('@everyone')) {
        await msg.delete().catch(() => null);
        return msg.member.timeout(3600000, "Mass Mention").catch(() => null);
    }

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) return msg.delete().catch(() => null);

    if (msg.content.length > 15) {
        const caps = msg.content.replace(/[^A-Z]/g, "").length;
        if (caps / msg.content.length > 0.8) return msg.delete().catch(() => null);
    }

    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++;
    else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(600000, "Spamming").catch(() => null);
    }
});

// Auto-Restore Logic (The part that usually causes Status 1 if errors aren't caught)
client.on('channelDelete', async (ch) => {
    try {
        const fetchedLogs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
        const exec = fetchedLogs?.entries.first()?.executor;
        if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

        await ch.guild.channels.create({
            name: ch.name, 
            type: ch.type, 
            parent: ch.parentId,
            permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
        });
    } catch (e) { console.error("Restore failed:", e); }
});

client.once('ready', async () => {
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        await rest.put(Routes.applicationCommands('1491381996025413764'), { body: commands });
        console.log("🛡️ CyberShield Online");
    } catch (error) { console.error(error); }
});

client.on('guildCreate', async (guild) => {
    const welcomeChannel = guild.systemChannel || guild.channels.cache.find(ch => 
        ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
    );
    if (welcomeChannel) {
        welcomeChannel.send(`Hello **${guild.name}**, I'm your new security bot! \n**IMPORTANT:** Use \`/setup\` and \`/settings\` to configure me. Only the owner can run \`/setup\`. Once done, you can choose a role to manage the rest. \nCheck us out: https://cyber-shield-gray.vercel.app`).catch(() => null);
    }
});

client.login(process.env.TOKEN);
