const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, AuditLogEvent 
} = require('discord.js');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('CyberShield: Custom Active 🛡️'));
app.listen(process.env.PORT || 3000);

const client = new Client({ intents: [Object.values(GatewayIntentBits)] });

// Persistent Settings (In-Memory for this example, usually a JSON/DB)
const settings = new Collection(); 
const nukeTracker = new Collection();
const msgTracker = new Collection();
const WHITELIST = ['YOUR_OWNER_ID'];

// Default Configuration Template
const DEFAULT_CONFIG = {
    logs: null,
    minAge: 1,         // Days
    joinLimit: 5,      // Users per burst
    spamLimit: 5,      // Messages
    nukeLimit: 3,      // Deletions
    antiInvite: true,  // Delete invites
    antiLink: true     // Delete scam links
};

// ===== 1. CORE SETUP ENGINE =====
const getGuildConfig = (guildId) => settings.get(guildId) || { ...DEFAULT_CONFIG };

const updateLogs = async (guild) => {
    let config = getGuildConfig(guild.id);
    let logCh = guild.channels.cache.get(config.logs) || guild.channels.cache.find(c => c.name === 'shield-logs');
    
    if (!logCh) {
        logCh = await guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
        config.logs = logCh?.id;
        settings.set(guild.id, config);
    }
    return logCh;
};

// ===== 2. CUSTOMIZABLE COMMANDS =====
const commands = [
    new SlashCommandBuilder()
        .setName('configure')
        .setDescription('Customize CyberShield security levels')
        .addIntegerOption(o => o.setName('age').setDescription('Min account age (days)'))
        .addIntegerOption(o => o.setName('spam').setDescription('Max messages allowed in 3s'))
        .addIntegerOption(o => o.setName('nuke').setDescription('Max deletions allowed in 10s'))
        .addBooleanOption(o => o.setName('invites').setDescription('Enable/Disable anti-invite link')),
    
    new SlashCommandBuilder().setName('settings').setDescription('View current security levels'),
    new SlashCommandBuilder().setName('setup').setDescription('Auto-repair log channels')
].map(c => c.toJSON());

client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    await int.deferReply({ ephemeral: true });

    if (!WHITELIST.includes(int.user.id)) return int.editReply("❌ Owner only.");

    let config = getGuildConfig(int.guildId);

    if (int.commandName === 'configure') {
        const age = int.options.getInteger('age');
        const spam = int.options.getInteger('spam');
        const nuke = int.options.getInteger('nuke');
        const invites = int.options.getBoolean('invites');

        if (age !== null) config.minAge = age;
        if (spam !== null) config.spamLimit = spam;
        if (nuke !== null) config.nukeLimit = nuke;
        if (invites !== null) config.antiInvite = invites;

        settings.set(int.guildId, config);
        return int.editReply(`✅ **Configuration Updated.** Run \`/settings\` to verify.`);
    }

    if (int.commandName === 'settings') {
        const embed = new EmbedBuilder()
            .setTitle("🛡️ CyberShield Current Configuration")
            .setColor("#2ecc71")
            .addFields(
                { name: "👶 Min Account Age", value: `${config.minAge} Days`, inline: true },
                { name: "💬 Spam Threshold", value: `${config.spamLimit} Msgs`, inline: true },
                { name: "💣 Nuke Threshold", value: `${config.nukeLimit} Actions`, inline: true },
                { name: "🔗 Anti-Invite", value: config.antiInvite ? "ON" : "OFF", inline: true }
            );
        return int.editReply({ embeds: [embed] });
    }

    if (int.commandName === 'setup') {
        await updateLogs(int.guild);
        return int.editReply("🛡️ Infrastructure verified and log channel synced.");
    }
});

// ===== 3. DYNAMIC SECURITY LISTENERS =====

// Join Gate using Custom Settings
client.on('guildMemberAdd', async (member) => {
    const config = getGuildConfig(member.guild.id);
    const age = (Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
    
    if (age < config.minAge) {
        return member.kick(`CyberShield: Security Age Gate (${config.minAge}d)`).catch(() => null);
    }
});

// Spam Filter using Custom Settings
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot || WHITELIST.includes(msg.author.id)) return;
    const config = getGuildConfig(msg.guild.id);

    // Dynamic Anti-Invite
    if (config.antiInvite && (msg.content.includes('discord.gg/') || msg.content.includes('discord.com/invite/'))) {
        return msg.delete().catch(() => null);
    }

    // Dynamic Spam Threshold
    let userData = msgTracker.get(msg.author.id) || { count: 0, last: Date.now() };
    const now = Date.now();
    if (now - userData.last < 3000) userData.count++;
    else userData.count = 1;
    userData.last = now;
    msgTracker.set(msg.author.id, userData);

    if (userData.count >= config.spamLimit) {
        await msg.delete().catch(() => null);
        await msg.member.timeout(600000, "Automated Spam Protection");
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands('1491381996025413764'), { body: commands });
    console.log("🛡️ CyberShield Customizable Online");
});

client.login(process.env.TOKEN);
