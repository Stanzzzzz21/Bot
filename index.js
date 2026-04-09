const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionsBitField, Collection, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.status(200).send('CyberShield Active'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, // CRITICAL: ENABLE IN DEV PORTAL
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
    antiInvite: true, antiNuke: true 
};

// --- LOGGING ENGINE ---
async function sendLog(guild, { title, msg, color = 0x2b2d31, user = null }) {
    try {
        const config = db.get(guild.id) || DEFAULT_CONFIG;
        if (!config.logChannel) return;
        const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
        if (!channel) return;
        const embed = new EmbedBuilder().setTitle(title).setDescription(msg).setColor(color).setTimestamp();
        if (user) embed.setFooter({ text: `Target: ${user.tag} (${user.id})` });
        await channel.send({ embeds: [embed] }).catch(() => null);
    } catch (e) { console.error("Logging failed."); }
}

// --- COMMAND DEFINITIONS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Link admin role and log channel')
        .addRoleOption(o => o.setName('admin').setRequired(true).setDescription('Moderator role')),
    new SlashCommandBuilder().setName('kick').setDescription('Kick a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to kick'))
        .addStringOption(o => o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a user')
        .addUserOption(o => o.setName('target').setRequired(true).setDescription('User to ban'))
        .addStringOption(o => o.setName('reason').setDescription('Reason')),
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
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };
    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    
    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "Error: Owner Only.", ephemeral: true });
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });
        config.adminRole = int.options.getRole('admin').id;
        config.logChannel = logCh.id;
        db.set(int.guildId, config);
        return int.reply({ content: "Setup Complete. Logs: #shield-logs", ephemeral: true });
    }

    if (!isAuth) return int.reply({ content: "Access Denied.", ephemeral: true });

    try {
        if (int.commandName === 'kick') {
            const user = int.options.getMember('target');
            if (!user.kickable) return int.reply({ content: "Cannot kick this user.", ephemeral: true });
            await user.kick(int.options.getString('reason') || "No reason.");
            return int.reply({ content: `Kicked ${user.user.tag}.`, ephemeral: true });
        }
        if (int.commandName === 'ban') {
            const user = int.options.getMember('target');
            if (!user.bannable) return int.reply({ content: "Cannot ban this user.", ephemeral: true });
            await user.ban({ reason: int.options.getString('reason') || "No reason." });
            return int.reply({ content: `Banned ${user.user.tag}.`, ephemeral: true });
        }
        if (int.commandName === 'purge') {
            const deleted = await int.channel.bulkDelete(Math.min(int.options.getInteger('amount'), 100), true);
            return int.reply({ content: `Cleaned ${deleted.size} messages.`, ephemeral: true });
        }
        if (int.commandName === 'freeze' || int.commandName === 'unfreeze') {
            const state = int.commandName === 'freeze' ? false : true;
            if (int.options.getString('scope') === 'channel') {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: state });
            } else {
                int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: state }).catch(()=>null); });
            }
            return int.reply({ content: `Server status: ${int.commandName}.`, ephemeral: true });
        }
    } catch (e) { return int.reply({ content: "Hierarchy Error.", ephemeral: true }); }
});

// --- AUTOMATED DEFENSE (WEBHOOKS + ANTI-INVITE) ---
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    const config = db.get(msg.guild.id) || DEFAULT_CONFIG;

    if (/discord(?:app)?\.com\/api\/webhooks\//i.test(msg.content)) {
        await msg.delete().catch(() => null);
        msg.channel.send("Blocked: Dangerous link.").then(m => setTimeout(() => m.delete().catch(() => null), 300000));
        return sendLog(msg.guild, { title: "Webhook Link Blocked", msg: `Channel: ${msg.channel.name}`, color: 0xff0000, user: msg.author });
    }

    if (config.antiInvite && /discord\.(gg|com\/invite)/i.test(msg.content)) {
        if (WHITELIST.includes(msg.author.id)) return;
        await msg.delete().catch(() => null);
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`${client.user.tag} Online`);
});

client.login(process.env.TOKEN);
