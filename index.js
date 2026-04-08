const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, Partials 
} = require('discord.js');
const express = require('express');

// ===== 1. RENDER STABILITY =====
const app = express();
app.get('/', (req, res) => res.send('Shield Active 🛡️'));
app.listen(process.env.PORT || 3000, '0.0.0.0');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const db = new Collection();
const antiSpamCache = new Collection();
const joinBurstCache = []; 
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1491381996025413764';

// ===== 2. SELF-HEALING RECOVERY LOGIC =====
const recoverInfrastructure = async (guild) => {
    let config = db.get(guild.id) || {};
    
    // Check if Log Channel still exists
    let logCh = guild.channels.cache.get(config.logChannel) || 
                guild.channels.cache.find(c => c.name === 'shield-logs');
    
    // Check if Mod Role still exists
    let modRole = guild.roles.cache.get(config.modRole) || 
                  guild.roles.cache.find(r => r.name === 'Shield Moderator');

    // Recovery: Re-create if deleted during raid
    if (!logCh) {
        logCh = await guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
    }

    if (!modRole) {
        modRole = await guild.roles.create({
            name: 'Shield Moderator',
            color: '#00ff99',
            reason: 'Self-Healing Recovery'
        }).catch(() => null);
    }

    db.set(guild.id, { modRole: modRole?.id, logChannel: logCh?.id });
    return { logCh, modRole };
};

// ===== 3. ANTI-RAID & WELCOME =====
client.on('guildMemberAdd', async (member) => {
    const { logCh } = await recoverInfrastructure(member.guild);
    const now = Date.now();

    // Account Age Gate
    const ageInDays = Math.floor((now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
    if (ageInDays < 2) {
        await member.kick('Anti-Raid: Account too new.').catch(() => {});
        if (logCh) logCh.send(`🛡️ **Raid Protection:** Kicked ${member.user.tag} (Account only ${ageInDays} days old).`);
        return;
    }

    // Join Burst Sensor
    joinBurstCache.push(now);
    while (joinBurstCache.length > 0 && now - joinBurstCache[0] > 10000) joinBurstCache.shift();

    if (joinBurstCache.length > 5) {
        if (logCh) logCh.send("🚨 **MASS JOIN DETECTED!** I am monitoring the situation. Use `/lockdown` if chat gets overwhelmed.");
    }

    // HELLO MESSAGE (Instructions for new members/staff)
    const welcome = new EmbedBuilder()
        .setTitle("🛡️ Cybershield Active")
        .setColor("#00ff99")
        .setDescription(`Welcome to **${member.guild.name}**. This server is protected by Cybershield.`)
        .addFields(
            { name: "Spam Protection", value: "Enabled (5 msgs / 5s)", inline: true },
            { name: "Link Filtering", value: "Invites Blocked", inline: true },
            { name: "Staff Tools", value: "Use `/lockdown`, `/mute`, and `/unpause`", inline: false }
        );
    
    // Send to a general channel if it exists, otherwise ignore
    const genCh = member.guild.systemChannel;
    if (genCh) genCh.send({ content: `Hello ${member}!`, embeds: [welcome] }).catch(() => {});
});

// ===== 4. COMMANDS & ACTIONS =====
const commands = [
    new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure the security system')
        .addStringOption(o => o.setName('mod_role').setDescription('Name of the staff role')),
    
    new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Freeze or unfreeze the channel')
        .addBooleanOption(o => o.setName('status').setDescription('True to lock, False to unlock').setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Silence a rule-breaker')
        .addUserOption(o => o.setName('target').setDescription('The user to mute').setRequired(true))
        .addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setRequired(true)),

    new SlashCommandBuilder()
        .setName('unpause')
        .setDescription('Restore server invites after a raid'),

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show bot and server security status')
].map(c => c.toJSON());

// Logging & Message Security
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (msg.content.includes('discord.gg/') && !msg.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        await msg.delete().catch(() => {});
    }
    // Anti-Spam
    const now = Date.now();
    const times = antiSpamCache.get(msg.author.id) || [];
    times.push(now);
    const recent = times.filter(t => now - t < 5000);
    antiSpamCache.set(msg.author.id, recent);
    if (recent.length > 5 && msg.member.moderatable) {
        await msg.member.timeout(600000, "Spam").catch(() => {});
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`🚀 System Online: ${client.user.tag}`);
});

client.login(TOKEN);
