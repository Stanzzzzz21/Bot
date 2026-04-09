const { 
    Client, GatewayIntentBits, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent, EmbedBuilder 
} = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.status(200).send('CyberShield Active'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration 
    ] 
});

const db = new Collection(); 
const msgTracker = new Collection();
const raidTracker = new Collection(); 
const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = { 
    adminRole: null, logChannel: null, 
    minAge: 3, spamLimit: 5, timeoutMinutes: 10,
    antiInvite: true, antiNuke: true, webhookScan: true 
};

// --- LOGGING ENGINE ---
async function sendLog(guild, { title, msg, color = 0x2b2d31, user = null }) {
    try {
        const config = db.get(guild.id) || DEFAULT_CONFIG;
        if (!config.logChannel) return;
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(title).setDescription(msg).setColor(color).setTimestamp();
        if (user) embed.setFooter({ text: `ID: ${user.id}` });
        await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) { console.error("Log failed."); }
}

// --- COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Link admin role and log channel')
        .addRoleOption(o => o.setName('admin').setRequired(true).setDescription('Moderator role')),
    new SlashCommandBuilder().setName('configure').setDescription('Customize limits')
        .addIntegerOption(o => o.setName('age').setDescription('Min account age'))
        .addIntegerOption(o => o.setName('spam').setDescription('Msgs per 3s limit')),
    new SlashCommandBuilder().setName('freeze').setDescription('Lock channel or server')
        .addStringOption(o => o.setName('scope').setRequired(true).setDescription('Scope').addChoices({name:'Channel', value:'channel'},{name:'Server', value:'server'})),
    new SlashCommandBuilder().setName('unfreeze').setDescription('Unlock channel or server')
        .addStringOption(o => o.setName('scope').setRequired(true).setDescription('Scope').addChoices({name:'Channel', value:'channel'},{name:'Server', value:'server'})),
    new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages')
        .addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Amount')),
    new SlashCommandBuilder().setName('settings').setDescription('View security status')
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;
    await int.deferReply({ ephemeral: true }).catch(() => null);
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.editReply("Error: Owner Only.");
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
        config.adminRole = int.options.getRole('admin').id;
        config.logChannel = logCh?.id || null;
        db.set(int.guildId, config);
        return int.editReply("Setup Complete.");
    }

    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.editReply("Access Denied.");

    try {
        if (int.commandName === 'freeze') {
            const scope = int.options.getString('scope');
            if (scope === 'channel') {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: false });
                return int.editReply("🔒 Channel Frozen.");
            } else {
                int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: false }).catch(()=>null); });
                return int.editReply("🔒 SERVER FROZEN.");
            }
        }
        if (int.commandName === 'unfreeze') {
            const scope = int.options.getString('scope');
            if (scope === 'channel') {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: true });
                return int.editReply("🔓 Channel Unfrozen.");
            } else {
                int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: true }).catch(()=>null); });
                return int.editReply("🔓 Server Unfrozen.");
            }
        }
        if (int.commandName === 'purge') {
            const deleted = await int.channel.bulkDelete(Math.min(int.options.getInteger('amount'), 100), true);
            return int.editReply(`Cleaned ${deleted.size} messages.`);
        }
    } catch (e) { return int.editReply("Error: Check Bot Hierarchy."); }
});

// --- THE FILTERS (WEBHOOK SCANNER INCLUDED) ---
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;
    if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;

    // 1. ADVANCED WEBHOOK SCANNER
    const webhookRegex = /discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;
    if (config.webhookScan && webhookRegex.test(msg.content)) {
        await msg.delete().catch(() => null);
        msg.channel.send("**Blocked:** Dangerous webhook link detected.").then(m => setTimeout(() => m.delete().catch(() => null), 300000));
        return sendLog(msg.guild, { title: "Webhook Link Blocked", msg: `Author: ${msg.author.tag}\nChannel: ${msg.channel.name}`, color: 0xff0000, user: msg.author });
    }

    // 2. ANTI-INVITE
    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        await msg.delete().catch(() => null);
        msg.channel.send("**Blocked:** Invite link.").then(m => setTimeout(() => m.delete().catch(() => null), 300000));
        return;
    }

    // 3. ANTI-SPAM
    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    if (Date.now() - userData.last < 3000) userData.count++; else userData.count = 1;
    userData.last = Date.now();
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(config.timeoutMinutes * 60000).catch(() => null);
        msg.channel.send(`**Muted:** ${msg.author.tag} for spam.`).then(m => setTimeout(() => m.delete().catch(() => null), 300000));
    }
});

// --- AUTO RAID PROTECTION & ANTI-NUKE ---
client.on('guildMemberAdd', async (member) => {
    const config = db.get(member.guild.id) || DEFAULT_CONFIG;
    let now = Date.now();
    let joins = raidTracker.get(member.guild.id) || [];
    joins = joins.filter(t => now - t < 10000); 
    joins.push(now);
    raidTracker.set(member.guild.id, joins);

    if (joins.length > 8) {
        const systemCh = member.guild.systemChannel || member.guild.channels.cache.find(c => c.name.includes('general'));
        if (systemCh) await systemCh.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(() => null);
        await sendLog(member.guild, { title: "Raid Detected", msg: "Server lockdown initiated.", color: 0xff0000 });
    }

    if ((now - member.user.createdTimestamp) / 86400000 < config.minAge) {
        await member.kick("Age Gate").catch(() => null);
    }
});

client.on('channelDelete', async (ch) => {
    const config = db.get(ch.guild?.id) || DEFAULT_CONFIG;
    if (!config.antiNuke) return;
    const logs = await ch.guild.fetchAuditLogs({ limit: 1, type: AuditLogEvent.ChannelDelete }).catch(() => null);
    const exec = logs?.entries.first()?.executor;
    if (exec?.id === client.user.id || WHITELIST.includes(exec?.id)) return;
    await ch.guild.channels.create({ name: ch.name, type: ch.type, parent: ch.parentId, permissionOverwrites: ch.permissionOverwrites.cache.map(p => ({ id: p.id, allow: p.allow, deny: p.deny })) }).catch(() => null);
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`${client.user.tag} Online`);
});

process.on('unhandledRejection', (e) => console.error(e));
client.login(process.env.TOKEN);
