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
        GatewayIntentBits.MessageContent, // Must be enabled in Dev Portal!
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

// --- FIX: SECURE LOGGING ---
async function sendLog(guild, { title, msg, color = 0x2b2d31, user = null }) {
    const config = db.get(guild.id) || DEFAULT_CONFIG;
    if (!config.logChannel) return;
    const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder().setTitle(title).setDescription(msg).setColor(color).setTimestamp();
    if (user) embed.setFooter({ text: `User: ${user.tag}` });
    await channel.send({ embeds: [embed] }).catch(() => console.error("Could not send to log channel. Check permissions."));
}

// --- COMMANDS ---
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup logs and admin role').addRoleOption(o => o.setName('admin').setRequired(true).setDescription('Admin role')),
    new SlashCommandBuilder().setName('freeze').setDescription('Lock channel or server').addStringOption(o => o.setName('scope').setRequired(true).setDescription('Scope').addChoices({name:'Channel', value:'channel'},{name:'Server', value:'server'})),
    new SlashCommandBuilder().setName('unfreeze').setDescription('Unlock channel or server').addStringOption(o => o.setName('scope').setRequired(true).setDescription('Scope').addChoices({name:'Channel', value:'channel'},{name:'Server', value:'server'})),
    new SlashCommandBuilder().setName('purge').setDescription('Clear messages').addIntegerOption(o => o.setName('amount').setRequired(true).setDescription('Amount')),
    new SlashCommandBuilder().setName('settings').setDescription('View bot status')
].map(c => c.toJSON());

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    // PERMISSION CHECK
    const isAuth = int.user.id === int.guild.ownerId || WHITELIST.includes(int.user.id) || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth && int.commandName !== 'setup') return int.reply({ content: "Access Denied.", ephemeral: true });

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply({ content: "Owner only.", ephemeral: true });
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });
        config.adminRole = int.options.getRole('admin').id;
        config.logChannel = logCh.id;
        db.set(int.guildId, config);
        return int.reply({ content: "✅ Setup Complete. Logs: #shield-logs", ephemeral: true });
    }

    // FREEZE/UNFREEZE Logic
    if (int.commandName === 'freeze') {
        const scope = int.options.getString('scope');
        if (scope === 'channel') {
            await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: false });
            return int.reply("🔒 Channel Frozen.");
        } else {
            int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: false }).catch(()=>null); });
            return int.reply("🔒 SERVER FROZEN.");
        }
    }
    
    if (int.commandName === 'unfreeze') {
        const scope = int.options.getString('scope');
        if (scope === 'channel') {
            await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: true });
            return int.reply("🔓 Channel Unfrozen.");
        } else {
            int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: true }).catch(()=>null); });
            return int.reply("🔓 Server Unfrozen.");
        }
    }
});

// --- READY ENGINE ---
client.once('ready', async () => {
    console.log(`System Online: ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("Commands Synchronized.");
    } catch (e) { console.error("Command Error:", e); }
});

client.login(process.env.TOKEN);
