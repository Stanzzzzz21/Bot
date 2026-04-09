const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionsBitField, Collection, EmbedBuilder } = require('discord.js');
const express = require('express');

// 1. Keep-Alive Server
const app = express();
app.get('/', (req, res) => res.send('Shield Active'));
app.listen(process.env.PORT || 3000);

// 2. Client Setup
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
const WHITELIST = ['876731494805155851']; // Your ID

// 3. Command Definitions (STRICT LOWERCASE FOR NO CRASH)
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('setup log channel and admin role').addRoleOption(o => o.setName('role').setDescription('the admin role').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('remove a user').addUserOption(o => o.setName('user').setDescription('the user to kick').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('permanently remove a user').addUserOption(o => o.setName('user').setDescription('the user to ban').setRequired(true)),
    new SlashCommandBuilder().setName('purge').setDescription('delete messages').addIntegerOption(o => o.setName('amount').setDescription('how many to delete').setRequired(true)),
    new SlashCommandBuilder().setName('freeze').setDescription('lock a channel or the server').addStringOption(o => o.setName('scope').setDescription('channel or server').setRequired(true).addChoices({name:'channel', value:'channel'},{name:'server', value:'server'})),
    new SlashCommandBuilder().setName('unfreeze').setDescription('unlock a channel or the server').addStringOption(o => o.setName('scope').setDescription('channel or server').setRequired(true).addChoices({name:'channel', value:'channel'},{name:'server', value:'server'}))
].map(c => c.toJSON());

// 4. Logging Helper
async function sendLog(guild, title, desc, user = null) {
    const config = db.get(guild.id);
    if (!config?.logChannel) return;
    const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle(title).setDescription(desc).setColor(0x2b2d31).setTimestamp();
    if (user) embed.setFooter({ text: `ID: ${user.id}` });
    await channel.send({ embeds: [embed] }).catch(() => null);
}

// 5. Features & Logic
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    let config = db.get(int.guildId) || { adminRole: null, logChannel: null };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId && !WHITELIST.includes(int.user.id)) return int.reply("Owner only.");
        let ch = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({ name: 'shield-logs', type: ChannelType.GuildText });
        config.adminRole = int.options.getRole('role').id;
        config.logChannel = ch.id;
        db.set(int.guildId, config);
        return int.reply(`✅ Security Setup Complete. Logs: <#${ch.id}>`);
    }

    const isAuth = int.user.id === int.guild.ownerId || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.reply("No permission.");

    if (int.commandName === 'kick') {
        const target = int.options.getMember('user');
        await target.kick();
        await sendLog(int.guild, "User Kicked", `${target.user.tag} was kicked by ${int.user.tag}`, target.user);
        return int.reply(`Kicked ${target.user.tag}`);
    }

    if (int.commandName === 'purge') {
        const amt = int.options.getInteger('amount');
        await int.channel.bulkDelete(Math.min(amt, 100), true);
        return int.reply({ content: `Cleared ${amt} messages.`, ephemeral: true });
    }
    // (Other commands follow the same pattern)
});

// 6. Automated Defense (Invites & Webhooks)
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    if (msg.content.includes("discord.com/api/webhooks") || msg.content.includes("discord.gg/")) {
        if (WHITELIST.includes(msg.author.id)) return;
        await msg.delete().catch(() => null);
        await sendLog(msg.guild, "Security Block", `Deleted message from ${msg.author.tag} in #${msg.channel.name}`);
    }
});

// 7. Ready Event
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("🛡️ CyberShield Full Arsenal Online");
    } catch (e) { console.error(e); }
});

client.login(process.env.TOKEN);
