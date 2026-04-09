const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionsBitField, Collection, EmbedBuilder } = require('discord.js');
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
const WHITELIST = ['876731494805155851']; 

// --- HELPER: SYSTEM LOGGING ---
async function sendLog(guild, title, msg, user = null) {
    const config = db.get(guild.id);
    if (!config || !config.logChannel) return;
    const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(msg)
        .setColor(0x2b2d31)
        .setTimestamp();
    if (user) embed.setFooter({ text: `Target: ${user.tag}` });
    
    await channel.send({ embeds: [embed] }).catch(() => null);
}

const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup logs').addRoleOption(o => o.setName('admin').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('target').setRequired(true)),
    new SlashCommandBuilder().setName('purge').setDescription('Delete msgs').addIntegerOption(o => o.setName('amount').setRequired(true))
].map(c => c.toJSON());

// --- WELCOME MESSAGE ON JOIN ---
client.on('guildCreate', async (guild) => {
    const channel = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (!channel) return;

    const welcome = new EmbedBuilder()
        .setTitle('🛡️ CyberShield Active')
        .setDescription('I am ready to protect the server.\n\n**Next Steps:**\n1. Run `/setup` to link your admin role.\n2. Move my role to the **top** of the list.')
        .setColor(0x57f287);
    
    channel.send({ embeds: [welcome] }).catch(() => null);
});

// --- COMMAND HANDLER + LOGGING ---
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    let config = db.get(int.guildId) || { adminRole: null, logChannel: null };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId) return int.reply({ content: "Owner only.", ephemeral: true });
        
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs',
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });

        config.adminRole = int.options.getRole('admin').id;
        config.logChannel = logCh.id;
        db.set(int.guildId, config);
        
        return int.reply({ content: `✅ Setup Complete. Logs will appear in <#${logCh.id}>`, ephemeral: true });
    }

    const isAuth = int.user.id === int.guild.ownerId || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.reply({ content: "No permission.", ephemeral: true });

    if (int.commandName === 'kick') {
        const target = int.options.getMember('target');
        if (!target.kickable) return int.reply("Cannot kick that user.");
        await target.kick();
        await sendLog(int.guild, "User Kicked", `Action by: ${int.user.tag}`, target.user);
        return int.reply(`Kicked ${target.user.tag}`);
    }

    if (int.commandName === 'ban') {
        const target = int.options.getMember('target');
        if (!target.bannable) return int.reply("Cannot ban that user.");
        await target.ban();
        await sendLog(int.guild, "User Banned", `Action by: ${int.user.tag}`, target.user);
        return int.reply(`Banned ${target.user.tag}`);
    }

    if (int.commandName === 'purge') {
        const amt = int.options.getInteger('amount');
        const deleted = await int.channel.bulkDelete(Math.min(amt, 100), true);
        await sendLog(int.guild, "Messages Purged", `${deleted.size} messages cleared in <#${int.channel.id}> by ${int.user.tag}`);
        return int.reply({ content: `Deleted ${deleted.size} messages.`, ephemeral: true });
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("🛡️ CyberShield Ready & Logging Active");
});

client.login(process.env.TOKEN);
