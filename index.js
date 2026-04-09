// =======================
// CyberShield X+ - All-in-One Security & Moderation Bot
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
app.get("/", (req, res) => res.send("🛡 CyberShield X+ Active"));
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

// In-memory per-session config
const guildConfig = new Collection(); 
/*
cfg = {
  staffRoleId: string|null,
  logChannelId: string|null,
  quarantineRoleId: string|null,
  quarantineChannelId: string|null,
  frozen: { server: bool, channels: Set<string> },
  welcome: {
    enabled: boolean,
    channelId: string|null,
    style: 'short'|'normal'|'detailed',
    customText: string|null,
    maxLines: number
  }
}
*/

const spamTracker = new Collection(); // key: guildId-userId -> timestamps[]
const raidTracker = new Collection(); // guildId -> timestamps[]
const WHITELIST = ["876731494805155851"]; // your IDs here

const WEBSITE_URL = "https://cyber-shield-gray.vercel.app/";

// -----------------------
// 3. Slash Commands
// -----------------------
const commands = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Setup staff role, logs, and quarantine system")
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
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    new SlashCommandBuilder()
        .setName("roleadd")
        .setDescription("Give a role to a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to give role to")
             .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName("role")
             .setDescription("Role to give")
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
        .setName("roleremove")
        .setDescription("Remove a role from a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to remove role from")
             .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName("role")
             .setDescription("Role to remove")
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    new SlashCommandBuilder()
        .setName("welcomeconfig")
        .setDescription("Configure the welcome system")
        .addChannelOption(o =>
            o.setName("channel")
             .setDescription("Channel for welcome messages")
             .setRequired(false)
        )
        .addStringOption(o =>
            o.setName("style")
             .setDescription("Welcome style")
             .addChoices(
                { name: "Short", value: "short" },
                { name: "Normal", value: "normal" },
                { name: "Detailed", value: "detailed" }
             )
             .setRequired(false)
        )
        .addStringOption(o =>
            o.setName("text")
             .setDescription("Custom welcome text (optional)")
             .setRequired(false)
        )
        .addIntegerOption(o =>
            o.setName("max_lines")
             .setDescription("Max lines of text (1-15)")
             .setRequired(false)
        )
        .addBooleanOption(o =>
            o.setName("enabled")
             .setDescription("Enable or disable welcome messages")
             .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
            quarantineRoleId: null,
            quarantineChannelId: null,
            frozen: {
                server: false,
                channels: new Set()
            },
            welcome: {
                enabled: true,
                channelId: null,
                style: "normal",
                customText: null,
                maxLines: 8
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

// Helper: send public notice that auto-deletes after 4 minutes
async function sendTempNotice(channel, content, options = {}) {
    const msg = await channel.send({ content, ...options }).catch(() => null);
    if (!msg) return;
    setTimeout(() => {
        msg.delete().catch(() => null);
    }, 4 * 60 * 1000);
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
    const cfg = getGuildConfig(guild);
    const systemChannel = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (!systemChannel) return;

    const descLines = [
        "Thanks for adding **CyberShield X+**!",
        "",
        "1. Run `/setup` to link your staff role and create the private log + quarantine system.",
        "2. Make sure I have **Administrator** or strong moderation permissions.",
        "3. I’ll automatically protect you from raids, nukes, spam, webhooks, and more.",
        "",
        `🔗 Dashboard & Info: ${WEBSITE_URL}`
    ];

    const embed = new EmbedBuilder()
        .setTitle("🛡 Meet CyberShield X+ — Your Ultimate Discord Anti-Raid")
        .setDescription(descLines.join("\n"))
        .setColor(0x5865f2)
        .setFooter({ text: "Version v2.4.0 (Live)" });

    systemChannel.send({ embeds: [embed] }).catch(() => null);

    // Default welcome channel to system channel if none set
    if (!cfg.welcome.channelId) {
        cfg.welcome.channelId = systemChannel.id;
    }
});

// -----------------------
// 7. Interaction Handler (Slash Commands)
// -----------------------
client.on("interactionCreate", async (int) => {
    if (!int.isChatInputCommand() || !int.guild) return;

    const cfg = getGuildConfig(int.guild);

    const isOwner = int.user.id === int.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(int.user.id);
    const isStaff = cfg.staffRoleId && int.member.roles.cache.has(cfg.staffRoleId);

    const requiresStaff = [
        "kick", "ban", "purge", "freeze", "unfreeze",
        "setup", "roleadd", "roleremove", "welcomeconfig"
    ].includes(int.commandName);

    if (requiresStaff && !(isOwner || isWhitelisted || isStaff)) {
        return int.reply({ content: "❌ You are not authorized to use this command.", ephemeral: true });
    }

    try {
        if (int.commandName === "setup") {
            const role = int.options.getRole("staff_role");

            // Create or find log channel
            let logChannel = int.guild.channels.cache.find(
                c => c.name === "shield-logs" && c.type === ChannelType.GuildText
            );
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

            // Create or find quarantine role
            let qRole = int.guild.roles.cache.find(r => r.name === "Quarantined");
            if (!qRole) {
                qRole = await int.guild.roles.create({
                    name: "Quarantined",
                    color: 0xff0000,
                    reason: "CyberShield Quarantine Role"
                });
            }

            // Create or find quarantine channel
            let qChannel = int.guild.channels.cache.find(
                c => c.name === "quarantine-hold" && c.type === ChannelType.GuildText
            );
            if (!qChannel) {
                qChannel = await int.guild.channels.create({
                    name: "quarantine-hold",
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: int.guild.roles.everyone.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: qRole.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                        }
                    ]
                });
            }

            cfg.staffRoleId = role.id;
            cfg.logChannelId = logChannel.id;
            cfg.quarantineRoleId = qRole.id;
            cfg.quarantineChannelId = qChannel.id;
            guildConfig.set(int.guild.id, cfg);

            await int.reply(
                `✅ Setup complete.\n` +
                `Staff Role: <@&${role.id}>\n` +
                `Logs: <#${logChannel.id}>\n` +
                `Quarantine Role: <@&${qRole.id}>\n` +
                `Quarantine Channel: <#${qChannel.id}>`
            );
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
            const targetUser = int.options.getUser("user");
            const target = int.guild.members.cache.get(targetUser.id) ||
                await int.guild.members.fetch(targetUser.id).catch(() => null);
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

        if (int.commandName === "roleadd") {
            const member = int.options.getMember("user");
            const role = int.options.getRole("role");

            if (!member || !role) {
                return int.reply({ content: "Invalid user or role.", ephemeral: true });
            }

            if (!int.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return int.reply({ content: "❌ I need **Manage Roles** permission.", ephemeral: true });
            }

            await member.roles.add(role).catch(() => null);
            await int.reply(`✅ Added role <@&${role.id}> to **${member.user.tag}**.`);
            await sendLog(int.guild, "Role Added", `${int.user.tag} added role ${role.name} to ${member.user.tag}`, int.user);
        }

        if (int.commandName === "roleremove") {
            const member = int.options.getMember("user");
            const role = int.options.getRole("role");

            if (!member || !role) {
                return int.reply({ content: "Invalid user or role.", ephemeral: true });
            }

            if (!int.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return int.reply({ content: "❌ I need **Manage Roles** permission.", ephemeral: true });
            }

            await member.roles.remove(role).catch(() => null);
            await int.reply(`✅ Removed role <@&${role.id}> from **${member.user.tag}**.`);
            await sendLog(int.guild, "Role Removed", `${int.user.tag} removed role ${role.name} from ${member.user.tag}`, int.user);
        }

        if (int.commandName === "welcomeconfig") {
            const channel = int.options.getChannel("channel");
            const style = int.options.getString("style");
            const text = int.options.getString("text");
            const maxLines = int.options.getInteger("max_lines");
            const enabled = int.options.getBoolean("enabled");

            if (channel && channel.type !== ChannelType.GuildText) {
                return int.reply({ content: "Channel must be a text channel.", ephemeral: true });
            }

            if (channel) cfg.welcome.channelId = channel.id;
            if (style) cfg.welcome.style = style;
            if (typeof enabled === "boolean") cfg.welcome.enabled = enabled;
            if (text) cfg.welcome.customText = text;
            if (maxLines) cfg.welcome.maxLines = Math.max(1, Math.min(15, maxLines));

            guildConfig.set(int.guild.id, cfg);

            await int.reply(
                "✅ Welcome configuration updated:\n" +
                `Enabled: **${cfg.welcome.enabled}**\n` +
                `Channel: ${cfg.welcome.channelId ? `<#${cfg.welcome.channelId}>` : "Not set"}\n` +
                `Style: **${cfg.welcome.style}**\n` +
                `Max Lines: **${cfg.welcome.maxLines}**`
            );
        }
    } catch (err) {
        console.error(err);
        if (!int.replied) {
            int.reply({ content: "❌ An error occurred while executing that command.", ephemeral: true }).catch(() => null);
        }
    }
});

// -----------------------
// 8. Welcome System (Member Join)
// -----------------------
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cfg = getGuildConfig(guild);

    // Auto-Quarantine + Age Gate
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

    if (accountAgeMs < threeDaysMs && cfg.quarantineRoleId && cfg.quarantineChannelId) {
        const qRole = guild.roles.cache.get(cfg.quarantineRoleId);
        const qChannel = guild.channels.cache.get(cfg.quarantineChannelId);

        if (qRole && qChannel) {
            await member.roles.add(qRole).catch(() => null);
            await qChannel.send({
                content: `🚧 ${member} has been placed in **quarantine** (account too new). A staff member will review you soon.`
            }).catch(() => null);

            await sendLog(
                guild,
                "Auto-Quarantine",
                `New account **${member.user.tag}** placed in quarantine (account < 3 days).`,
                member.user
            );
        }
    }

    if (!cfg.welcome.enabled) return;

    const channel = cfg.welcome.channelId
        ? guild.channels.cache.get(cfg.welcome.channelId)
        : guild.systemChannel;

    if (!channel || channel.type !== ChannelType.GuildText) return;

    // Build welcome text based on style
    let lines = [];

    if (cfg.welcome.customText) {
        lines = cfg.welcome.customText.split("\n");
    } else {
        if (cfg.welcome.style === "short") {
            lines = [
                `Welcome ${member} to **${guild.name}**!`,
                `Read the rules and enjoy your stay.`,
                `🔗 Security powered by CyberShield: ${WEBSITE_URL}`
            ];
        } else if (cfg.welcome.style === "detailed") {
            lines = [
                `👋 Welcome ${member} to **${guild.name}**!`,
                "",
                "You're joining a server protected by **CyberShield X+**:",
                "• Anti-Raid & Beast Mode",
                "• Anti-Nuke & Webhook Guard",
                "• Auto-Quarantine for suspicious accounts",
                "• Smart Anti-Spam & Invite Shield",
                "",
                `Make sure to read the rules and verify if required.`,
                `🔗 Learn more: ${WEBSITE_URL}`
            ];
        } else {
            // normal
            lines = [
                `Welcome ${member} to **${guild.name}**!`,
                "",
                "This server is protected by **CyberShield X+** (anti-raid, anti-nuke, anti-spam).",
                `🔗 Info & dashboard: ${WEBSITE_URL}`
            ];
        }
    }

    // Apply maxLines limit
    lines = lines.slice(0, cfg.welcome.maxLines);

    const embed = new EmbedBuilder()
        .setTitle(`Welcome to ${guild.name}!`)
        .setDescription(lines.join("\n"))
        .setColor(0x57f287)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
        // Auto-delete public welcome after 4 minutes
        setTimeout(() => {
            msg.delete().catch(() => null);
        }, 4 * 60 * 1000);
    }
});

// -----------------------
// 9. Automated Security Systems
// -----------------------

// 9.1 Webhook Guard & Invite Shield (message-level)
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
        await sendTempNotice(
            msg.channel,
            `⚠️ A message from ${msg.author} was removed for containing a blocked ${hasWebhook ? "webhook" : "invite"} link.`
        );
    }
});

// 9.2 Webhook Guard (creation-level)
client.on("webhookUpdate", async (channel) => {
    if (!channel.guild) return;
    const guild = channel.guild;
    const cfg = getGuildConfig(guild);

    try {
        const logs = await guild.fetchAuditLogs({ type: 50, limit: 1 }); // WEBHOOK_CREATE
        const entry = logs.entries.first();
        if (!entry) return;

        const executor = entry.executor;
        const isOwner = executor.id === guild.ownerId;
        const isWhitelisted = WHITELIST.includes(executor.id);
        const member = guild.members.cache.get(executor.id);
        const isStaff = cfg.staffRoleId && member?.roles.cache.has(cfg.staffRoleId);

        if (isOwner || isWhitelisted || isStaff) return;

        const webhook = entry.target;
        if (webhook && webhook.delete) {
            await webhook.delete("Unauthorized webhook creation blocked by CyberShield").catch(() => null);
        }

        await sendLog(
            guild,
            "Webhook Guard",
            `Unauthorized webhook created by **${executor.tag}** in #${channel.name} was deleted.`,
            executor
        );
        if (channel.isTextBased()) {
            await sendTempNotice(
                channel,
                `🛡 Unauthorized webhook was blocked in this channel.`
            );
        }
    } catch (err) {
        console.error("Webhook Guard error:", err);
    }
});

// 9.3 Anti-Spam (5 messages / 3s -> 10 min timeout)
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

    const filtered = timestamps.filter(t => now - t < 3000);
    spamTracker.set(key, filtered);

    if (filtered.length >= 5) {
        if (msg.member.moderatable) {
            await msg.member.timeout(10 * 60 * 1000, "Auto Anti-Spam").catch(() => null);
            await sendTempNotice(
                msg.channel,
                `⛔ ${msg.author} has been timed out for **spamming** (10 minutes).`
            );
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

// 9.4 Beast Mode (Raid Defense) - 8 joins / 10s -> auto-freeze server
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cfg = getGuildConfig(guild);

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
            await sendTempNotice(
                systemChannel,
                "⚠️ **Raid detected.** Server has been automatically frozen. Use `/unfreeze server` when safe."
            );
        }
    }
});

// 9.5 Anti-Nuke (Channel Delete Protection + Rogue Staff Punish)
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
        const member = guild.members.cache.get(executor.id);
        const isStaff = cfg.staffRoleId && member?.roles.cache.has(cfg.staffRoleId);

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

        // Punish rogue user: strip roles with dangerous perms (basic heuristic)
        if (member && member.manageable) {
            const rolesToRemove = member.roles.cache.filter(r =>
                r.id !== guild.id && // not @everyone
                (r.permissions.has(PermissionsBitField.Flags.Administrator) ||
                 r.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                 r.permissions.has(PermissionsBitField.Flags.ManageGuild))
            );
            for (const r of rolesToRemove.values()) {
                await member.roles.remove(r).catch(() => null);
            }
            if (member.moderatable) {
                await member.timeout(30 * 60 * 1000, "Anti-Nuke: Rogue channel deletion").catch(() => null);
            }
        }

        await sendLog(
            guild,
            "Anti-Nuke Triggered",
            `Channel **${channel.name}** was deleted by **${executor.tag}** and has been recreated.\n` +
            `Dangerous permissions have been stripped and the user may be timed out.`,
            executor
        );

        if (newChannel && channel.isTextBased()) {
            await sendTempNotice(
                newChannel,
                "🛡 This channel was recreated by Anti-Nuke protection."
            );
        }
    } catch (err) {
        console.error("Anti-Nuke error:", err);
    }
});

// -----------------------
// 10. Login
// -----------------------
client.login(process.env.TOKEN).catch(err => {
    console.error("Failed to login:", err);
});
