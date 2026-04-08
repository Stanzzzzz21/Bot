const { 
    Client, GatewayIntentBits, EmbedBuilder, REST, Routes, 
    SlashCommandBuilder, ChannelType, PermissionsBitField, 
    Collection, Partials 
} = require('discord.js');
const express = require('express');

// ===== 1. RENDER CONNECTIVITY (Instant Port Binding) =====
const app = express();
app.get('/', (req, res) => res.send('Shield Active 🛡️'));
app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log("✅ Web server live."));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const db = new Collection();
const antiSpamCache = new Collection();
const joinBurstCache = [];
const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1491381996025413764';

// ===== 2. INFRASTRUCTURE RECOVERY (Self-Healing) =====
const recoverShield = async (guild) => {
    let config = db.get(guild.id) || {};
    let logCh = guild.channels.cache.get(config.logChannel) || guild.channels.cache.find(c => c.name === 'shield-logs');
    let modRole = guild.roles.cache.get(config.modRole) || guild.roles.cache.find(r => r.name === 'Shield Moderator');

    if (!logCh) {
        logCh = await guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        }).catch(() => null);
    }
    if (!modRole) {
        modRole = await guild.roles.create({ name: 'Shield Moderator', color: '#00ff99' }).catch(() => null);
    }
    db.set(guild.id, { modRole: modRole?.id, logChannel: logCh?.id });
    return { logCh, modRole };
};

// ===== 3. JOIN PROTECTION (Anti-Raid) =====
client.on('guildMemberAdd', async (member) => {
    const { logCh } = await recoverShield(member.guild);
    const now = Date.now();

    // Age Check (2 Days)
    const ageDays = Math.floor((now - member.user.createdTimestamp) / 86400000);
    if (ageDays < 2) {
        await member.kick('Anti-Raid: New Account').catch(() => {});
        return logCh?.send(`🛡️ **Kicked:** ${member.user.tag} (Account only ${ageDays}d old)`);
    }

    // Burst Check (5 joins in 10s)
    joinBurstCache.push(now);
    while (joinBurstCache.length > 0 && now - joinBurstCache[0] > 10000) joinBurstCache.shift();
    if (joinBurstCache.length > 5) logCh?.send("🚨 **RAID WARNING:** High join volume detected!");
});

// ===== 4. COMMANDS (Lower-case, No spaces) =====
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Repair or create shield infrastructure'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Toggle channel lock').addBooleanOption(o => o.setName('on').setDescription('True=Lock').setRequired(true)),
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a user').addUserOption(o => o.setName('user').setDescription('Target').setRequired(true)).addIntegerOption(o => o.setName('mins').setDescription('Minutes').setRequired(true))
].map(c => c.toJSON());

// ===== 5. INTERACTION HANDLER (FIXES "DID NOT RESPOND") =====
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;

    // STEP 1: DEFER (Tells Discord to wait)
    await int.deferReply({ ephemeral: true });

    const { commandName, guild, options, member } = int;
    const { logCh, modRole } = await recoverShield(guild);
    const isMod = member.permissions.has(PermissionsBitField.Flags.Administrator) || member.roles.cache.has(modRole?.id);

    if (!isMod) return int.editReply("❌ You lack Shield Moderator permissions.");

    try {
        if (commandName === 'setup') {
            await recoverShield(guild);
            return int.editReply("✅ **Infrastructure healed.** Logs and Roles are ready.");
        }

        if (commandName === 'lockdown') {
            const lock = options.getBoolean('on');
            await int.channel.permissionOverwrites.edit(guild.id, { SendMessages: !lock });
            return int.editReply(`🔒 Lockdown is now **${lock ? 'ON' : 'OFF'}**.`);
        }

        if (commandName === 'mute') {
            const target = options.getMember('user');
            if (!target.moderatable) return int.editReply("❌ Cannot mute this user.");
            await target.timeout(options.getInteger('mins') * 60000);
            return int.editReply(`✅ Silenced **${target.user.tag}**.`);
        }
    } catch (e) {
        return int.editReply("❌ Execution error. Check bot permissions.");
    }
});

// ===== 6. CHAT SECURITY (Spam/Links) =====
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (msg.content.includes('discord.gg/') && !msg.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return msg.delete().catch(() => {});
    }
    const times = antiSpamCache.get(msg.author.id) || [];
    times.push(Date.now());
    const recent = times.filter(t => Date.now() - t < 5000);
    antiSpamCache.set(msg.author.id, recent);
    if (recent.length > 5 && msg.member.moderatable) {
        await msg.member.timeout(600000, "Spam");
        await msg.channel.bulkDelete(recent.length).catch(() => {});
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`🚀 Shield Online: ${client.user.tag}`);
});

client.login(TOKEN);
