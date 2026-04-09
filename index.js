const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

// --- KEEP ALIVE ---
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('CyberShield is Pulse-Active 🛡️'));
app.listen(port, () => console.log(`Keep-Alive running on ${port}`));

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
    managerRole: null,
    logs: null,
    minAge: 1,
    spamLimit: 5,
    nukeLimit: 3,
    antiInvite: true,
    joinLimit: 5
};

// Auth Check: Does the user have permission?
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
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({ name: 'shield-logs', type: ChannelType.GuildText, permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
        config.logs = logCh.id;
        db.set(int.guildId, config);
        return int.reply({ content: `✅ Setup complete. <@&${role.id}> can now manage the bot.`, ephemeral: true });
    }

    if (!isAuth(int, config)) return int.reply({ content: "❌ No permission.", ephemeral: true });

    // Mod Commands
    if (int.commandName === 'kick') {
        const target = int.options.getMember('target');
        if (!target.kickable) return int.reply("❌ Cannot kick.");
        await target.kick();
        return int.reply(`👞 Kicked **${target.user.tag}**`);
    }

    if (int.commandName === 'ban') {
        const target = int.options.getMember('target');
        if (!target.bannable) return int.reply("❌ Cannot ban.");
        await target.ban();
        return int.reply(`🔨 Banned **${target.user.tag}**`);
    }

    if (int.commandName === 'purge') {
        const amt = int.options.getInteger('amount');
        await int.channel.bulkDelete(Math.min(amt, 100));
        return int.reply({ content: `🧹 Cleared ${amt} messages.`, ephemeral: true });
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

// Merged Member Add (Age Gate + Scam Names + Raid)
client.on('guildMemberAdd', async (member) => {
    const config = db.get(member.guild.id) || DEFAULT_CONFIG;
    const now = Date.now();
    
    const badNames = ["discord.gg/", "free-nitro", "nuke-bot"];
    if (badNames.some(n => member.user.username.toLowerCase().includes(n))) return member.ban({ reason: "Scam Name" });

    const age = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    if (age < config.minAge) return member.kick("Age Gate");

    joinTracker.push(now);
    if (joinTracker.filter(t => t > now - 10000).length > config.joinLimit) return member.kick("Raid Protection");
});

// Merged Message (Spam + Caps + Mentions + Invites)
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    if (msg.mentions.users.size > 5 || msg.content.includes('@everyone')) {
        await msg.delete();
        return msg.member.timeout(3600000, "Mass Mention");
    }

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) return msg.delete();

    if (msg.content.length > 15) {
        const caps = msg.content.replace(/[^A-Z]/g, "").length;
        if (caps / msg.content.length > 0.8) return msg.delete();
    }

    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++;
    else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete();
        await msg.member.timeout(600000, "Spamming");
    }
});

// Auto-Restore Logic
client.on('channelDelete', async (ch) => {
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete });
    const exec = logs.entries.first()?.executor;
    if (exec && (WHITELIST.includes(exec.id) || exec.id === ch.guild.ownerId)) return;

    await ch.guild.channels.create({
        name: ch.name, type: ch.type, parent: ch.parentId,
        permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny }))
    });
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands('1491381996025413764'), { body: commands });
    console.log("🛡️ CyberShield Online");
});

client.on('guildCreate', async (guild) => {
    const welcomeChannel = guild.systemChannel || guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages));
    if (welcomeChannel) welcomeChannel.send(`Hello **${guild.name}**, I'm your new security bot! \n**IMPORTANT:** Use \`/setup\` and \`/settings\` to configure me, please not that only the owner can run the /setup command for security reasons, when settign up you can choose a Administrator role to run the rest of the commands. \nCheck us out: https://cyber-shield-gray.vercel.app`);
});

client.login(process.env.TOKEN);
