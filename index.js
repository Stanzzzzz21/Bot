// =======================
// CyberShield X - All-in-One Security Bot
// =======================
// Requirements:
//   npm install discord.js express
// Environment:
//   process.env.TOKEN  - your bot token
//   process.env.PORT   - for keep-alive (Render/Replit/etc.)

const {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    PermissionsBitField,
    PermissionFlagsBits,
    EmbedBuilder
} = require("discord.js");
const express = require("express");

// -----------------------
// 1. Keep-Alive Web Server
// -----------------------
const app = express();
app.get("/", (req, res) => res.send("🛡 CyberShield X Active"));
app.listen(process.env.PORT || 3000, () =>
    console.log("🌐 Keep-alive server running")
);

// -----------------------
// 2. Client Setup
// -----------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

// In-memory "DB" (per session)
const guildConfig = new Collection(); // { guildId: { staffRoleId, logChannelId, frozen: {server: bool, channels: Set} } }
const spamTracker = new Collection(); // key: guildId-userId -> timestamps[]
const raidTracker = new Collection(); // guildId -> timestamps[]
const WHITELIST = ["876731494805155851"]; // Add your ID(s) here (owner-safe)

// -----------------------
// 3. Slash Commands
// -----------------------
const commands = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Setup staff role and log channel")
        .addRoleOption(o =>
            o.setName("staff_role")
             .setDescription("Staff/admin role")
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to kick")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for kick")
             .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to ban")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for ban")
             .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Bulk delete messages in this channel")
        .addIntegerOption(o =>
            o.setName("amount")
             .setDescription("Number of messages (1-100)")
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName("freeze")
        .setDescription("Freeze a channel or the entire server")
        .addStringOption(o =>
            o.setName("scope")
             .setDescription("Freeze scope")
             .setRequired(true)
             .addChoices(
                { name: "Channel", value: "channel" },
                { name: "Server", value: "server" }
             )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("unfreeze")
        .setDescription("Unfreeze a channel or the entire server")
        .addStringOption(o =>
            o.setName("scope")
             .setDescription("Unfreeze scope")
             .setRequired(true)
             .addChoices(
                { name: "Channel", value: "channel" },
                { name: "Server", value: "server" }
             )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
].map(c => c.toJSON());

// -----------------------
// 4. Helper: Get/Init Config
// -----------------------
function getGuildConfig(guild) {
    let cfg = guildConfig.get(guild.id);
    if (!cfg) {
        cfg = {
            staffRoleId: null,
            logChannelId: null,
            frozen: {
                server: false,
                channels: new Set()
            }
        };
        guildConfig.set(guild.id, cfg);
    }
    return cfg;
}

// -----------------------
// 5. Logging Helper
// -----------------------
async function sendLog(guild, title, desc, user = null) {
    const cfg = getGuildConfig(guild);
    if (!cfg.logChannelId) return;

    const channel = guild.channels.cache.get(cfg.logChannelId) ||
        await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(0x2b2d31)
        .setTimestamp();

    if (user) embed.setFooter({ text: `User ID: ${user.id}` });

    await channel.send({ embeds: [embed] }).catch(() => null);
}

// -----------------------
// 6. Ready & Command Registration
// -----------------------
client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log("🛡 Slash commands registered globally.");
    } catch (err) {
        console.error("Failed to register commands:", err);
    }
});

// Welcome / guidance when bot joins a server
client.on("guildCreate", async (guild) => {
    const systemChannel = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (!systemChannel) return;

    const embed = new EmbedBuilder()
        .setTitle("🛡 CyberShield X Online")
        .setDescription(
            "Thanks for adding me!\n\n" +
            "1. Run `/setup` to link your staff role and create the private log channel.\n" +
            "2. Make sure I have **Administrator** or at least moderation permissions.\n" +
            "3. I’ll automatically protect you from raids, nukes, spam, webhooks, and more."
        )
        .setColor(0x5865f2);

    systemChannel.send({ embeds: [embed] }).catch(() => null);
});

// -----------------------
// 7. Interaction Handler (Slash Commands)
// -----------------------
client.on("interactionCreate", async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;

    const cfg = getGuildConfig(int.guild);

    // Owner or staff check for sensitive commands
    const isOwner = int.user.id === int.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(int.user.id);
    const isStaff = cfg.staffRoleId && int.member.roles.cache.has(cfg.staffRoleId);

    const requiresStaff = ["kick", "ban", "purge", "freeze", "unfreeze", "setup"].includes(int.commandName);
    if (requiresStaff && !(isOwner || isWhitelisted || isStaff)) {
        return int.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    }

    try {
        if (int.commandName === "setup") {
            const role = int.options.getRole("staff_role");
            // Create or find log channel
            let logChannel = int.guild.channels.cache.find(c => c.name === "shield-logs" && c.type === ChannelType.GuildText);
            if (!logChannel) {
                logChannel = await int.guild.channels.create({
                    name: "shield-logs",
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: int.guild.roles.everyone.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        }
                    ]
                });
            }

            cfg.staffRoleId = role.id;
            cfg.logChannelId = logChannel.id;
            guildConfig.set(int.guild.id, cfg);

            await int.reply(`✅ Setup complete.\nStaff Role: <@&${role.id}>\nLogs: <#${logChannel.id}>`);
            await sendLog(int.guild, "Setup Completed", `Setup run by ${int.user.tag}`, int.user);
        }

        if (int.commandName === "kick") {
            const target = int.options.getMember("user");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!target) return int.reply({ content: "User not found.", ephemeral: true });
            if (!target.kickable) return int.reply({ content: "❌ I cannot kick this user.", ephemeral: true });

            await target.kick(reason);
            await int.reply(`✅ Kicked **${target.user.tag}**\nReason: ${reason}`);
            await sendLog(int.guild, "User Kicked", `${target.user.tag} was kicked by ${int.user.tag}\nReason: ${reason}`, target.user);
        }

        if (int.commandName === "ban") {
            const target = int.options.getMember("user") || await int.guild.members.fetch(int.options.getUser("user").id).catch(() => null);
            const reason = int.options.getString("reason") || "No reason provided";

            if (!target) return int.reply({ content: "User not found.", ephemeral: true });
            if (!target.bannable) return int.reply({ content: "❌ I cannot ban this user.", ephemeral: true });

            await target.ban({ reason });
            await int.reply(`✅ Banned **${target.user.tag}**\nReason: ${reason}`);
            await sendLog(int.guild, "User Banned", `${target.user.tag} was banned by ${int.user.tag}\nReason: ${reason}`, target.user);
        }

        if (int.commandName === "purge") {
            const amount = int.options.getInteger("amount");
            if (amount < 1 || amount > 100) {
                return int.reply({ content: "Amount must be between 1 and 100.", ephemeral: true });
            }

            const deleted = await int.channel.bulkDelete(amount, true).catch(() => null);
            const count = deleted ? deleted.size : 0;

            await int.reply({ content: `🧹 Cleared **${count}** messages.`, ephemeral: true });
            await sendLog(int.guild, "Messages Purged", `${int.user.tag} purged ${count} messages in #${int.channel.name}`, int.user);
        }

        if (int.commandName === "freeze") {
            const scope = int.options.getString("scope");

            if (scope === "channel") {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                    SendMessages: false
                });
                cfg.frozen.channels.add(int.channel.id);
                await int.reply("🧊 This channel has been **frozen**. Only staff can speak.");
                await sendLog(int.guild, "Channel Frozen", `${int.user.tag} froze #${int.channel.name}`, int.user);
            } else {
                // Server freeze
                cfg.frozen.server = true;
                for (const ch of int.guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
                        await ch.permissionOverwrites.edit(int.guild.roles.everyone, {
                            SendMessages: false
                        }).catch(() => null);
                    }
                }
                await int.reply("🧊 **Server frozen.** Only staff can speak.");
                await sendLog(int.guild, "Server Frozen", `${int.user.tag} froze the server`, int.user);
            }
        }

        if (int.commandName === "unfreeze") {
            const scope = int.options.getString("scope");

            if (scope === "channel") {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                    SendMessages: null
                });
                cfg.frozen.channels.delete(int.channel.id);
                await int.reply("🔥 This channel has been **unfrozen**.");
                await sendLog(int.guild, "Channel Unfrozen", `${int.user.tag} unfroze #${int.channel.name}`, int.user);
            } else {
                cfg.frozen.server = false;
                for (const ch of int.guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
                        await ch.permissionOverwrites.edit(int.guild.roles.everyone, {
                            SendMessages: null
                        }).catch(() => null);
                    }
                }
                await int.reply("🔥 **Server unfrozen.**");
                await sendLog(int.guild, "Server Unfrozen", `${int.user.tag} unfroze the server`, int.user);
            }
        }
    } catch (err) {
        console.error(err);
        if (!int.replied) {
            int.reply({ content: "❌ An error occurred while executing that command.", ephemeral: true }).catch(() => null);
        }
    }
});

// -----------------------
// 8. Automated Security Systems
// -----------------------

// 8.1 Webhook Scanner & Anti-Invite
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    const isStaff = cfg.staffRoleId && msg.member?.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    // Skip staff/owner/whitelist
    if (isStaff || isOwner || isWhitelisted) return;

    const content = msg.content.toLowerCase();
    const hasWebhook = content.includes("discord.com/api/webhooks");
    const hasInvite = content.includes("discord.gg/") || content.includes("discord.com/invite/");

    if (hasWebhook || hasInvite) {
        await msg.delete().catch(() => null);
        await sendLog(
            msg.guild,
            "Security Block",
            `Deleted message from **${msg.author.tag}** in #${msg.channel.name}\nReason: ${hasWebhook ? "Webhook link" : "Invite link"}`,
            msg.author
        );
    }
});

// 8.2 Anti-Spam (5 messages / 3s -> 10 min timeout)
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    const isStaff = cfg.staffRoleId && msg.member?.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    if (isStaff || isOwner || isWhitelisted) return;

    const key = `${msg.guild.id}-${msg.author.id}`;
    const now = Date.now();

    if (!spamTracker.has(key)) spamTracker.set(key, []);
    const timestamps = spamTracker.get(key);
    timestamps.push(now);

    // Keep only last 3 seconds
    const filtered = timestamps.filter(t => now - t < 3000);
    spamTracker.set(key, filtered);

    if (filtered.length >= 5) {
        // Apply 10-minute timeout
        if (msg.member.moderatable) {
            await msg.member.timeout(10 * 60 * 1000, "Auto Anti-Spam").catch(() => null);
            await msg.channel.send(`⛔ ${msg.author} has been timed out for **spamming** (10 minutes).`).catch(() => null);
            await sendLog(
                msg.guild,
                "Anti-Spam Triggered",
                `${msg.author.tag} was timed out for spamming.`,
                msg.author
            );
        }
        spamTracker.delete(key);
    }
});

// 8.3 Beast Mode (Raid Defense) - 8 joins / 10s -> auto-freeze server
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cfg = getGuildConfig(guild);

    // Age Gate: kick accounts younger than 3 days
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (accountAgeMs < threeDaysMs) {
        await member.kick("Age Gate: Account younger than 3 days").catch(() => null);
        await sendLog(
            guild,
            "Age Gate",
            `Kicked **${member.user.tag}** (account too new).`,
            member.user
        );
        return;
    }

    const now = Date.now();
    const key = guild.id;

    if (!raidTracker.has(key)) raidTracker.set(key, []);
    const joins = raidTracker.get(key);
    joins.push(now);

    const filtered = joins.filter(t => now - t < 10000);
    raidTracker.set(key, filtered);

    if (filtered.length >= 8 && !cfg.frozen.server) {
        cfg.frozen.server = true;
        for (const ch of guild.channels.cache.values()) {
            if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
                await ch.permissionOverwrites.edit(guild.roles.everyone, {
                    SendMessages: false
                }).catch(() => null);
            }
        }
        await sendLog(
            guild,
            "Beast Mode Activated",
            "Detected raid (8+ joins/10s). Server automatically frozen."
        );
        const systemChannel = guild.systemChannel;
        if (systemChannel) {
            systemChannel.send("⚠️ **Raid detected.** Server has been automatically frozen. Use `/unfreeze server` when safe.").catch(() => null);
        }
    }
});

// 8.4 Anti-Nuke (Channel Delete Protection)
client.on("channelDelete", async (channel) => {
    if (!channel.guild) return;
    const guild = channel.guild;
    const cfg = getGuildConfig(guild);

    try {
        const logs = await guild.fetchAuditLogs({ type: 12, limit: 1 }); // CHANNEL_DELETE
        const entry = logs.entries.first();
        if (!entry) return;

        const executor = entry.executor;
        const isOwner = executor.id === guild.ownerId;
        const isWhitelisted = WHITELIST.includes(executor.id);
        const isStaff = cfg.staffRoleId && guild.members.cache.get(executor.id)?.roles.cache.has(cfg.staffRoleId);

        // If owner/whitelisted/staff did it, allow
        if (isOwner || isWhitelisted || isStaff) return;

        // Recreate channel
        const newChannel = await guild.channels.create({
            name: channel.name,
            type: channel.type,
            topic: channel.topic ?? null,
            parent: channel.parentId ?? null,
            position: channel.rawPosition
        }).catch(() => null);

        await sendLog(
            guild,
            "Anti-Nuke Triggered",
            `Channel **${channel.name}** was deleted by **${executor.tag}** and has been recreated.`,
            executor
        );

        if (newChannel && channel.isTextBased()) {
            newChannel.send("🛡 This channel was recreated by Anti-Nuke protection.").catch(() => null);
        }
    } catch (err) {
        console.error("Anti-Nuke error:", err);
    }
});

// -----------------------
// 9. Login
// -----------------------
client.login(process.env.TOKEN).catch(err => {
    console.error("Failed to login:", err);
});
