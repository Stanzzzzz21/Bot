const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, PermissionsBitField, Collection, AuditLogEvent, EmbedBuilder } = require('discord.js');
const express = require('express');

// 1. WEB SERVER (For 24/7 Hosting)
const app = express();
app.get('/', (req, res) => res.status(200).send('Shield Active'));
app.listen(process.env.PORT || 3000);

// 2. CLIENT SETUP (Intents must be enabled in Dev Portal)
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
const msgTracker = new Collection();
const raidTracker = new Collection(); 
const WHITELIST = ['876731494805155851']; 

const DEFAULT_CONFIG = { adminRole: null, logChannel: null, minAge: 3, spamLimit: 5 };

// 3. LOGGING ENGINE
async function sendLog(guild, title, msg, user = null) {
    const config = db.get(guild.id);
    if (!config?.logChannel) return;
    const channel = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle(title).setDescription(msg).setColor(0x2b2d31).setTimestamp();
    if (user) embed.setFooter({ text: `Target: ${user.tag}` });
    await channel.send({ embeds: [embed] }).catch(() => null);
}

// 4. COMMAND LIST (Full Mod + Utility)
const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Setup logs').addRoleOption(o => o.setName('admin').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('Kick user').addUserOption(o => o.setName('target').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban user').addUserOption(o => o.setName('target').setRequired(true)).addStringOption(o => o.setName('reason')),
    new SlashCommandBuilder().setName('freeze').setDescription('Lock').addStringOption(o => o.setName('scope').setRequired(true).addChoices({name:'Server', value:'server'},{name:'Channel', value:'channel'})),
    new SlashCommandBuilder().setName('unfreeze').setDescription('Unlock').addStringOption(o => o.setName('scope').setRequired(true).addChoices({name:'Server', value:'server'},{name:'Channel', value:'channel'})),
    new SlashCommandBuilder().setName('purge').setDescription('Clear msgs').addIntegerOption(o => o.setName('amount').setRequired(true))
].map(c => c.toJSON());

// 5. EVENT HANDLERS
client.on('interactionCreate', async (int) => {
    if (!int.isChatInputCommand()) return;
    let config = db.get(int.guildId) || { ...DEFAULT_CONFIG };

    if (int.commandName === 'setup') {
        if (int.user.id !== int.guild.ownerId) return int.reply({ content: "Owner only.", ephemeral: true });
        let logCh = int.guild.channels.cache.find(c => c.name === 'shield-logs') || await int.guild.channels.create({
            name: 'shield-logs', type: ChannelType.GuildText,
            permissionOverwrites: [{ id: int.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }]
        });
        config.adminRole = int.options.getRole('admin').id;
        config.logChannel = logCh.id;
        db.set(int.guildId, config);
        return int.reply({ content: `✅ Setup Complete. Logs: <#${logCh.id}>`, ephemeral: true });
    }

    const isAuth = int.user.id === int.guild.ownerId || (config.adminRole && int.member.roles.cache.has(config.adminRole));
    if (!isAuth) return int.reply({ content: "No permission.", ephemeral: true });

    try {
        if (int.commandName === 'kick') {
            const target = int.options.getMember('target');
            await target.kick();
            await sendLog(int.guild, "User Kicked", `Action by: ${int.user.tag}`, target.user);
            return int.reply(`Kicked ${target.user.tag}`);
        }
        if (int.commandName === 'ban') {
            const target = int.options.getMember('target');
            await target.ban();
            await sendLog(int.guild, "User Banned", `Action by: ${int.user.tag}`, target.user);
            return int.reply(`Banned ${target.user.tag}`);
        }
        if (int.commandName === 'purge') {
            const amt = int.options.getInteger('amount');
            const deleted = await int.channel.bulkDelete(Math.min(amt, 100), true);
            await sendLog(int.guild, "Messages Purged", `${deleted.size} messages cleared in <#${int.channel.id}>`);
            return int.reply({ content: `Deleted ${deleted.size} messages.`, ephemeral: true });
        }
        if (int.commandName === 'freeze' || int.commandName === 'unfreeze') {
            const state = int.commandName === 'freeze' ? false : true;
            if (int.options.getString('scope') === 'channel') {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: state });
            } else {
                int.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(int.guild.roles.everyone, { SendMessages: state }).catch(()=>null); });
            }
            return int.reply(`Status updated: ${int.commandName}.`);
        }
    } catch (e) { return int.reply({ content: "Role Error: Move my role higher!", ephemeral: true }); }
});

// 6. AUTO-SECURITY FILTERS (WEBHOOKS + INVITES)
client.on('messageCreate', async (msg) => {
    if (!msg.guild || msg.author.bot) return;
    
    // Webhook Scanner
    if (msg.content.includes("discord.com/api/webhooks")) {
        await msg.delete().catch(() => null);
        await sendLog(msg.guild, "Webhook Blocked", `Dangerous link from ${msg.author.tag}`);
        return;
    }

    // Anti-Invite
    if (/discord\.(gg|com\/invite)/i.test(msg.content)) {
        if (WHITELIST.includes(msg.author.id) || msg.author.id === msg.guild.ownerId) return;
        await msg.delete().catch(() => null);
    }
});

// 7. BEAST MODE (RAID PROTECTION)
client.on('guildMemberAdd', async (member) => {
    let now = Date.now();
    let joins = raidTracker.get(member.guild.id) || [];
    joins = joins.filter(t => now - t < 10000); joins.push(now);
    raidTracker.set(member.guild.id, joins);

    if (joins.length > 8) {
        member.guild.channels.cache.forEach(c => { if(c.type === ChannelType.GuildText) c.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false }).catch(()=>null); });
        await sendLog(member.guild, "Raid Detected", "Server Lockdown.");
    }
});

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log("🛡️ CyberShield FULL Arsenal Online");
    } catch (e) { console.error("Command Sync Failed."); }
});

client.login(process.env.TOKEN);
