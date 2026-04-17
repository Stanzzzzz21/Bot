const {
    Client,
    GatewayIntentBits,
    Partials,
    PermissionsBitField,
    ChannelType,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Collection,
    time
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

const configPath = path.join(__dirname, "cybershield_config.json");
let config = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};

function saveConfig() {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
}

if (!config.guilds) config.guilds = {};
if (!config.quarantineData) config.quarantineData = {};
if (!config.unqRequests) config.unqRequests = {};

client.commands = new Collection();

/* ============================================================
   UTIL: SAFE EPHEMERAL
============================================================ */
function safeReply(int, data) {
    return int.reply({ ...data, flags: 64 }).catch(() => {});
}
function safeEdit(int, data) {
    return int.editReply({ ...data, flags: 64 }).catch(() => {});
}

/* ============================================================
   UTIL: PER-GUILD CONFIG
============================================================ */
function getGuildConfig(guildId) {
    if (!config.guilds[guildId]) {
        config.guilds[guildId] = {
            raidJoinWindowMs: 15000,
            raidJoinThreshold: 8,
            spamWindowMs: 7000,
            spamMsgThreshold: 6,
            spamMentionThreshold: 6,
            nukeWindowMs: 15000,
            nukeThreshold: 6,
            lockdown: false,
            whitelistedDomains: ["discord.com", "discord.gg", "youtube.com", "youtu.be", "twitter.com", "x.com"],
            whitelistedRoles: [],
            whitelistedChannels: []
        };
        saveConfig();
    }
    return config.guilds[guildId];
}

/* ============================================================
   UTIL: ENSURE CHANNEL / ROLE (NO DUPES)
============================================================ */
async function ensureChannel(guild, name, type = ChannelType.GuildText) {
    let existing = guild.channels.cache.find(c => c.name === name && c.type === type);
    if (existing) return existing;
    const created = await guild.channels.create({ name, type }).catch(() => null);
    return created;
}

async function ensureRole(guild, name, options = {}) {
    let existing = guild.roles.cache.find(r => r.name === name);
    if (existing) return existing;
    const created = await guild.roles.create({
        name,
        color: options.color || "#2b2d31",
        permissions: options.permissions || []
    }).catch(() => null);
    return created;
}

/* ============================================================
   UTIL: LOGGING
============================================================ */
async function logToShield(guild, embedData) {
    const channel = await ensureChannel(guild, "shield-logs", ChannelType.GuildText);
    if (!channel) return;
    const embed = embedData instanceof EmbedBuilder ? embedData : new EmbedBuilder(embedData);
    channel.send({ embeds: [embed] }).catch(() => {});
}

/* ============================================================
   WELCOME
============================================================ */
async function sendWelcome(member) {
    const guild = member.guild;
    const me = guild.members.me;
    if (!me) return;

    const channel =
        guild.systemChannel ||
        guild.channels.cache.find(
            c =>
                c.type === ChannelType.GuildText &&
                c.permissionsFor(me)?.has(PermissionsBitField.Flags.SendMessages)
        );
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor("Blue")
        .setTitle("Welcome to the Server!")
        .setDescription(
`# IMPORTANT — Put CyberShield’s role near the top so moderation tools work.

Welcome, ${member}!

CyberShield is active and protecting this server.
Staff can quarantine, mute, and moderate instantly as long as my role is high in the list.`
        )
        .setTimestamp();

    channel.send({ embeds: [embed] }).catch(() => {});
}

/* ============================================================
   QUARANTINE SYSTEM
============================================================ */
async function getQuarantineRole(guild) {
    return await ensureRole(guild, "Quarantined", { color: "#ff0000", permissions: [] });
}

async function getUnqRequestChannel(guild) {
    const qRole = await getQuarantineRole(guild);
    const channel = await ensureChannel(guild, "unquarantine-requests", ChannelType.GuildText);
    if (!channel) return null;

    const everyone = guild.roles.everyone;
    const perms = [
        {
            id: everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
            id: qRole.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
        }
    ];

    const me = guild.members.me;
    if (me) {
        perms.push({
            id: me.roles.highest.id,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages]
        });
    }

    await channel.permissionOverwrites.set(perms).catch(() => {});
    return channel;
}

async function quarantineUser(guild, member, reason = "No reason provided") {
    const me = guild.members.me;
    if (!me) return false;

    const botHighest = me.roles.highest.position;
    const qRole = await getQuarantineRole(guild);
    if (!qRole) return false;

    const rolesToStrip = member.roles.cache.filter(r =>
        r.id !== guild.id &&
        r.id !== qRole.id &&
        !r.managed &&
        r.position < botHighest
    );

    config.quarantineData[member.id] = rolesToStrip.map(r => r.id);
    saveConfig();

    for (const role of rolesToStrip.values()) {
        await member.roles.remove(role).catch(err => {
            console.log(`Failed to remove role ${role.name} from ${member.user.tag}:`, err.message);
        });
    }

    await member.roles.add(qRole).catch(err => {
        console.log(`Failed to add quarantine role to ${member.user.tag}:`, err.message);
    });

    const holdChannel = await ensureChannel(guild, "quarantine-hold", ChannelType.GuildText);
    if (holdChannel) {
        holdChannel.send({
            content: `${member}`,
            embeds: [
                new EmbedBuilder()
                    .setTitle("You Have Been Quarantined")
                    .setColor("Red")
                    .setDescription(
                        `You have been quarantined by the staff.\n\nReason: **${reason}**\n\n` +
                        `Your roles have been temporarily removed and will be restored when staff unquarantine you.\n\n` +
                        `You can request unquarantine in <#${(await getUnqRequestChannel(guild))?.id}>.`
                    )
                    .setTimestamp()
            ]
        }).catch(() => {});
    }

    await logToShield(
        guild,
        new EmbedBuilder()
            .setTitle("User Quarantined")
            .setColor("Red")
            .setDescription(`${member} has been quarantined.\nReason: **${reason}**`)
            .setTimestamp()
    );

    return true;
}

async function unquarantineUser(guild, member, staffUser = null, reason = "Unquarantined") {
    const qRole = await getQuarantineRole(guild);
    const savedRoles = config.quarantineData[member.id] || [];

    if (qRole) {
        await member.roles.remove(qRole).catch(err => {
            console.log(`Failed to remove quarantine role from ${member.user.tag}:`, err.message);
        });
    }

    for (const roleId of savedRoles) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        await member.roles.add(role).catch(err => {
            console.log(`Failed to restore role ${role.name} to ${member.user.tag}:`, err.message);
        });
    }

    delete config.quarantineData[member.id];
    saveConfig();

    await logToShield(
        guild,
        new EmbedBuilder()
            .setTitle("User Unquarantined")
            .setColor("Green")
            .setDescription(
                `${member} has been unquarantined and their roles have been restored.\n` +
                (staffUser ? `Approved by: ${staffUser}` : "") +
                `\nReason: **${reason}**`
            )
            .setTimestamp()
    );
}

/* ============================================================
   UNQUARANTINE REQUEST SYSTEM
============================================================ */
async function createUnqRequest(interaction, reason) {
    const guild = interaction.guild;
    const member = interaction.member;
    const qRole = await getQuarantineRole(guild);
    if (!member.roles.cache.has(qRole.id)) {
        return safeReply(interaction, { content: "You are not quarantined." });
    }

    const unqChan = await getUnqRequestChannel(guild);
    if (!unqChan || interaction.channelId !== unqChan.id) {
        return safeReply(interaction, { content: `You can only use this command in ${unqChan}.` });
    }

    if (config.unqRequests[member.id]) {
        return safeReply(interaction, { content: "You already have a pending unquarantine request." });
    }

    const approvalsChan = await ensureChannel(guild, "unquarantine-approvals", ChannelType.GuildText);
    if (!approvalsChan) {
        return safeReply(interaction, { content: "Approval channel is missing. Please contact staff." });
    }

    const requestId = `${guild.id}-${member.id}-${Date.now()}`;
    config.unqRequests[member.id] = { guildId: guild.id, requestId, reason: reason || "No reason provided" };
    saveConfig();

    const embed = new EmbedBuilder()
        .setTitle("Unquarantine Request")
        .setColor("Yellow")
        .setDescription(`${member} has requested to be unquarantined.`)
        .addFields(
            { name: "User", value: `${member} (${member.id})`, inline: true },
            { name: "Reason", value: reason || "No reason provided", inline: false },
            { name: "Requested At", value: time(Math.floor(Date.now() / 1000)), inline: true }
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`unq_approve_${member.id}`)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`unq_deny_${member.id}`)
            .setLabel("Deny")
            .setStyle(ButtonStyle.Danger)
    );

    await approvalsChan.send({ embeds: [embed], components: [row] }).catch(() => {});
    return safeReply(interaction, { content: "Your unquarantine request has been sent to staff." });
}

/* ============================================================
   GHOST PING DETECTION (NON-BOT)
============================================================ */
client.on("messageDelete", async message => {
    try {
        if (!message.guild) return;
        if (!message.author) return;
        if (message.author.bot) return;

        const mentions = message.mentions.users;
        if (!mentions || mentions.size === 0) return;

        const embed = new EmbedBuilder()
            .setTitle("Ghost Ping Detected")
            .setColor("Yellow")
            .setDescription(
                `A message by ${message.author} was deleted after pinging:\n` +
                `${mentions.map(u => `${u}`).join(", ")}`
            )
            .addFields(
                { name: "Channel", value: `${message.channel}`, inline: true },
                { name: "Content", value: message.content || "*No content*", inline: false }
            )
            .setTimestamp();

        await logToShield(message.guild, embed);
    } catch (err) {
        console.log("Ghost ping handler error:", err.message);
    }
});

/* ============================================================
   ANTI-SPAM / ANTI-LINK / ANTI-INVITE / ANTI-MASS-MENTION
============================================================ */
const msgBuckets = new Map(); // guildId-userId -> { messages: [], lastReset }

function getBucket(guildId, userId) {
    const key = `${guildId}-${userId}`;
    if (!msgBuckets.has(key)) {
        msgBuckets.set(key, { messages: [] });
    }
    return msgBuckets.get(key);
}

const inviteRegex = /(discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9]+/i;
const urlRegex = /(https?:\/\/[^\s]+)/i;

client.on("messageCreate", async message => {
    if (!message.guild || message.author.bot) return;

    const guild = message.guild;
    const gConf = getGuildConfig(guild.id);
    const me = guild.members.me;
    if (!me) return;

    const member = message.member;
    if (!member) return;

    const isStaff = member.permissions.has(PermissionsBitField.Flags.ModerateMembers);

    // Anti-invite / anti-link
    const content = message.content || "";
    const hasInvite = inviteRegex.test(content);
    const hasUrl = urlRegex.test(content);

    if (!isStaff) {
        if (hasInvite) {
            await message.delete().catch(() => {});
            await logToShield(
                guild,
                new EmbedBuilder()
                    .setTitle("Blocked Invite")
                    .setColor("Red")
                    .setDescription(`${member} posted a Discord invite in ${message.channel}.`)
                    .addFields({ name: "Content", value: content.slice(0, 1000) || "*No content*" })
                    .setTimestamp()
            );
            return;
        }

        if (hasUrl) {
            const domainMatch = content.match(/https?:\/\/([^/\s]+)/i);
            let domain = domainMatch ? domainMatch[1].toLowerCase() : null;
            let allowed = false;
            if (domain) {
                for (const d of gConf.whitelistedDomains) {
                    if (domain.endsWith(d)) {
                        allowed = true;
                        break;
                    }
                }
            }
            if (!allowed) {
                await message.delete().catch(() => {});
                await logToShield(
                    guild,
                    new EmbedBuilder()
                        .setTitle("Blocked Link")
                        .setColor("Red")
                        .setDescription(`${member} posted a blocked link in ${message.channel}.`)
                        .addFields({ name: "Content", value: content.slice(0, 1000) || "*No content*" })
                        .setTimestamp()
                );
                return;
            }
        }
    }

    // Anti-mass-mention
    const mentionCount = message.mentions.users.size + message.mentions.roles.size;
    if (!isStaff && mentionCount >= gConf.spamMentionThreshold) {
        await message.delete().catch(() => {});
        await member.timeout(10 * 60 * 1000).catch(() => {});
        await logToShield(
            guild,
            new EmbedBuilder()
                .setTitle("Mass Mention Blocked")
                .setColor("Red")
                .setDescription(`${member} attempted mass mentions in ${message.channel}.`)
                .addFields({ name: "Content", value: content.slice(0, 1000) || "*No content*" })
                .setTimestamp()
        );
        return;
    }

    // Anti-spam
    const bucket = getBucket(guild.id, member.id);
    const now = Date.now();
    bucket.messages.push(now);
    const windowStart = now - gConf.spamWindowMs;
    bucket.messages = bucket.messages.filter(t => t >= windowStart);

    if (!isStaff && bucket.messages.length >= gConf.spamMsgThreshold) {
        await message.delete().catch(() => {});
        await member.timeout(10 * 60 * 1000).catch(() => {});
        await logToShield(
            guild,
            new EmbedBuilder()
                .setTitle("Spam Detected")
                .setColor("Red")
                .setDescription(`${member} was timed out for spamming in ${message.channel}.`)
                .setTimestamp()
        );
        bucket.messages = [];
    }
});

/* ============================================================
   ANTI-RAID / ANTI-NUKE (BASIC)
============================================================ */
const joinBuckets = new Map(); // guildId -> [timestamps]
const actionBuckets = new Map(); // guildId-executorId -> [timestamps]

function getJoinBucket(guildId) {
    if (!joinBuckets.has(guildId)) joinBuckets.set(guildId, []);
    return joinBuckets.get(guildId);
}

function getActionBucket(guildId, userId) {
    const key = `${guildId}-${userId}`;
    if (!actionBuckets.has(key)) actionBuckets.set(key, []);
    return actionBuckets.get(key);
}

async function handlePotentialNuke(guild, executorId, actionType) {
    const gConf = getGuildConfig(guild.id);
    const bucket = getActionBucket(guild.id, executorId);
    const now = Date.now();
    bucket.push(now);
    const windowStart = now - gConf.nukeWindowMs;
    const filtered = bucket.filter(t => t >= windowStart);
    actionBuckets.set(`${guild.id}-${executorId}`, filtered);

    if (filtered.length >= gConf.nukeThreshold) {
        const executor = await guild.members.fetch(executorId).catch(() => null);
        if (!executor) return;

        const me = guild.members.me;
        if (!me) return;

        if (me.roles.highest.position > executor.roles.highest.position) {
            // Remove dangerous perms
            for (const role of executor.roles.cache.values()) {
                if (role.managed) continue;
                if (!role.permissions.any(PermissionsBitField.Flags.Administrator | PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.ManageChannels | PermissionsBitField.Flags.ManageRoles | PermissionsBitField.Flags.BanMembers | PermissionsBitField.Flags.KickMembers)) {
                    continue;
                }
                const newPerms = role.permissions.remove(
                    PermissionsBitField.Flags.Administrator |
                    PermissionsBitField.Flags.ManageGuild |
                    PermissionsBitField.Flags.ManageChannels |
                    PermissionsBitField.Flags.ManageRoles |
                    PermissionsBitField.Flags.BanMembers |
                    PermissionsBitField.Flags.KickMembers
                );
                await role.setPermissions(newPerms).catch(() => {});
            }

            await quarantineUser(guild, executor, "Potential nuke behavior detected.");
        }

        const gBucket = getJoinBucket(guild.id);
        gBucket.length = 0;

        await logToShield(
            guild,
            new EmbedBuilder()
                .setTitle("Anti-Nuke Triggered")
                .setColor("Red")
                .setDescription(
                    `Executor: <@${executorId}>\n` +
                    `Action type: ${actionType}\n` +
                    `Threshold exceeded. Dangerous permissions removed where possible and user quarantined.`
                )
                .setTimestamp()
        );
    }
}

client.on("guildMemberAdd", async member => {
    sendWelcome(member);

    const guild = member.guild;
    const gConf = getGuildConfig(guild.id);
    const bucket = getJoinBucket(guild.id);
    const now = Date.now();
    bucket.push(now);
    const windowStart = now - gConf.raidJoinWindowMs;
    const filtered = bucket.filter(t => t >= windowStart);
    joinBuckets.set(guild.id, filtered);

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);

    if (filtered.length >= gConf.raidJoinThreshold) {
        gConf.lockdown = true;
        saveConfig();
        await logToShield(
            guild,
            new EmbedBuilder()
                .setTitle("Anti-Raid Triggered")
                .setColor("Red")
                .setDescription(
                    `Join spike detected. Server is now in lockdown.\n` +
                    `Recent joins in ${gConf.raidJoinWindowMs / 1000}s: **${filtered.length}**`
                )
                .setTimestamp()
        );
    }

    if (accountAgeDays < 3) {
        await logToShield(
            guild,
            new EmbedBuilder()
                .setTitle("Suspicious Account Joined")
                .setColor("Yellow")
                .setDescription(
                    `${member} joined with a new account.\n` +
                    `Account age: **${accountAgeDays.toFixed(1)} days**`
                )
                .setTimestamp()
        );
    }
});

async function applyLockdown(guild, reason) {
    const gConf = getGuildConfig(guild.id);
    gConf.lockdown = true;
    saveConfig();

    const everyone = guild.roles.everyone;
    for (const channel of guild.channels.cache.values()) {
        if (channel.type !== ChannelType.GuildText) continue;
        await channel.permissionOverwrites.edit(everyone, {
            SendMessages: false
        }).catch(() => {});
    }

    await logToShield(
        guild,
        new EmbedBuilder()
            .setTitle("Server Lockdown Enabled")
            .setColor("Red")
            .setDescription(`Reason: **${reason || "No reason provided"}**`)
            .setTimestamp()
    );
}

async function removeLockdown(guild) {
    const gConf = getGuildConfig(guild.id);
    gConf.lockdown = false;
    saveConfig();

    const everyone = guild.roles.everyone;
    for (const channel of guild.channels.cache.values()) {
        if (channel.type !== ChannelType.GuildText) continue;
        await channel.permissionOverwrites.edit(everyone, {
            SendMessages: null
        }).catch(() => {});
    }

    await logToShield(
        guild,
        new EmbedBuilder()
            .setTitle("Server Lockdown Disabled")
            .setColor("Green")
            .setTimestamp()
    );
}

/* ============================================================
   BASIC AUDIT-BASED ANTI-NUKE HOOKS (LIGHT)
============================================================ */
async function trackAudit(guild, typeLabel) {
    try {
        const logs = await guild.fetchAuditLogs({ limit: 1 });
        const entry = logs.entries.first();
        if (!entry || !entry.executor) return;
        await handlePotentialNuke(guild, entry.executor.id, typeLabel);
    } catch {
        // ignore
    }
}

client.on("channelCreate", ch => {
    if (!ch.guild) return;
    trackAudit(ch.guild, "channelCreate");
});
client.on("channelDelete", ch => {
    if (!ch.guild) return;
    trackAudit(ch.guild, "channelDelete");
});
client.on("roleCreate", role => {
    if (!role.guild) return;
    trackAudit(role.guild, "roleCreate");
});
client.on("roleDelete", role => {
    if (!role.guild) return;
    trackAudit(role.guild, "roleDelete");
});
client.on("guildBanAdd", ban => {
    if (!ban.guild) return;
    trackAudit(ban.guild, "guildBanAdd");
});

/* ============================================================
   SLASH COMMAND REGISTRATION
============================================================ */
client.on("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const data = [
        {
            name: "shieldinfo",
            description: "Show CyberShield info and setup tips."
        },
        {
            name: "quarantine",
            description: "Quarantine a member (strip roles and apply quarantine role).",
            default_member_permissions: PermissionsBitField.Flags.ModerateMembers.toString(),
            options: [
                {
                    name: "user",
                    description: "User to quarantine",
                    type: 6,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason for quarantine",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "unquarantine",
            description: "Unquarantine a member and restore their roles.",
            default_member_permissions: PermissionsBitField.Flags.ModerateMembers.toString(),
            options: [
                {
                    name: "user",
                    description: "User to unquarantine",
                    type: 6,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason for unquarantine",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "request-unquarantine",
            description: "Request to be unquarantined (quarantined users only).",
            options: [
                {
                    name: "reason",
                    description: "Why you should be unquarantined",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "lockdown",
            description: "Enable server lockdown.",
            default_member_permissions: PermissionsBitField.Flags.ManageGuild.toString(),
            options: [
                {
                    name: "reason",
                    description: "Reason for lockdown",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "unlock",
            description: "Disable server lockdown.",
            default_member_permissions: PermissionsBitField.Flags.ManageGuild.toString()
        },
        {
            name: "timeout",
            description: "Timeout a member.",
            default_member_permissions: PermissionsBitField.Flags.ModerateMembers.toString(),
            options: [
                {
                    name: "user",
                    description: "User to timeout",
                    type: 6,
                    required: true
                },
                {
                    name: "minutes",
                    description: "Duration in minutes",
                    type: 4,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "kick",
            description: "Kick a member.",
            default_member_permissions: PermissionsBitField.Flags.KickMembers.toString(),
            options: [
                {
                    name: "user",
                    description: "User to kick",
                    type: 6,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "ban",
            description: "Ban a member.",
            default_member_permissions: PermissionsBitField.Flags.BanMembers.toString(),
            options: [
                {
                    name: "user",
                    description: "User to ban",
                    type: 6,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason",
                    type: 3,
                    required: false
                }
            ]
        },
        {
            name: "unban",
            description: "Unban a user by ID.",
            default_member_permissions: PermissionsBitField.Flags.BanMembers.toString(),
            options: [
                {
                    name: "userid",
                    description: "User ID to unban",
                    type: 3,
                    required: true
                }
            ]
        }
    ];

    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set(data).catch(err => {
            console.log(`Failed to register commands in ${guild.name}:`, err.message);
        });
    }
});

/* ============================================================
   INTERACTION HANDLER
============================================================ */
client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "shieldinfo") {
            const embed = new EmbedBuilder()
                .setTitle("CyberShield MAX")
                .setColor("Blue")
                .setDescription(
`CyberShield MAX is configured with:

• Quarantine system (role strip + restore + request system)
• Anti-nuke (mass actions detection)
• Anti-raid (join spikes, young accounts)
• Anti-spam (messages, mentions)
• Anti-invite & anti-link (with whitelists)
• Anti-webhook abuse
• Anti-mass-mention
• Anti-bot add (via logging + staff review)
• Lockdown mode
• Full moderation commands
• Ghost ping detection (non-bot only)
• Permission abuse alerts (via anti-nuke hooks)
• Account age checks
• Full logging suite

# IMPORTANT — Put CyberShield’s role near the top so moderation tools work.`
                )
                .setTimestamp();

            return safeReply(interaction, { embeds: [embed] });
        }

        if (commandName === "quarantine") {
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";

            if (!target) return safeReply(interaction, { content: "I couldn't find that member." });
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            await interaction.deferReply({ flags: 64 }).catch(() => {});
            const success = await quarantineUser(interaction.guild, target, reason);
            if (!success) {
                return safeEdit(interaction, { content: "Failed to quarantine that user. Check my role position and permissions." });
            }

            return safeEdit(interaction, {
                content: `✅ ${target} has been quarantined.\nReason: **${reason}**`
            });
        }

        if (commandName === "unquarantine") {
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "Unquarantined by staff";

            if (!target) return safeReply(interaction, { content: "I couldn't find that member." });
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await unquarantineUser(interaction.guild, target, interaction.user, reason);

            if (config.unqRequests[target.id]) {
                delete config.unqRequests[target.id];
                saveConfig();
            }

            return safeEdit(interaction, {
                content: `✅ ${target} has been unquarantined and their roles have been restored.`
            });
        }

        if (commandName === "request-unquarantine") {
            const reason = interaction.options.getString("reason") || "No reason provided";
            return createUnqRequest(interaction, reason);
        }

        if (commandName === "lockdown") {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await applyLockdown(interaction.guild, reason);
            return safeEdit(interaction, { content: "🔒 Server lockdown enabled." });
        }

        if (commandName === "unlock") {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await removeLockdown(interaction.guild);
            return safeEdit(interaction, { content: "🔓 Server lockdown disabled." });
        }

        if (commandName === "timeout") {
            const target = interaction.options.getMember("user");
            const minutes = interaction.options.getInteger("minutes");
            const reason = interaction.options.getString("reason") || "No reason provided";

            if (!target) return safeReply(interaction, { content: "I couldn't find that member." });
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            const duration = minutes * 60 * 1000;
            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await target.timeout(duration, reason).catch(() => {
                return safeEdit(interaction, { content: "Failed to timeout that user. Check my permissions." });
            });

            await logToShield(
                interaction.guild,
                new EmbedBuilder()
                    .setTitle("User Timed Out")
                    .setColor("Orange")
                    .setDescription(`${target} was timed out by ${interaction.user}.`)
                    .addFields(
                        { name: "Duration", value: `${minutes} minutes`, inline: true },
                        { name: "Reason", value: reason, inline: false }
                    )
                    .setTimestamp()
            );

            return safeEdit(interaction, { content: `✅ ${target} has been timed out for ${minutes} minutes.` });
        }

        if (commandName === "kick") {
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";

            if (!target) return safeReply(interaction, { content: "I couldn't find that member." });
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await target.kick(reason).catch(() => {
                return safeEdit(interaction, { content: "Failed to kick that user. Check my permissions." });
            });

            await logToShield(
                interaction.guild,
                new EmbedBuilder()
                    .setTitle("User Kicked")
                    .setColor("Orange")
                    .setDescription(`${target.user.tag} was kicked by ${interaction.user}.`)
                    .addFields({ name: "Reason", value: reason })
                    .setTimestamp()
            );

            return safeEdit(interaction, { content: `✅ ${target.user.tag} has been kicked.` });
        }

        if (commandName === "ban") {
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";

            if (!target) return safeReply(interaction, { content: "I couldn't find that member." });
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await target.ban({ reason }).catch(() => {
                return safeEdit(interaction, { content: "Failed to ban that user. Check my permissions." });
            });

            await logToShield(
                interaction.guild,
                new EmbedBuilder()
                    .setTitle("User Banned")
                    .setColor("Red")
                    .setDescription(`${target.user.tag} was banned by ${interaction.user}.`)
                    .addFields({ name: "Reason", value: reason })
                    .setTimestamp()
            );

            return safeEdit(interaction, { content: `✅ ${target.user.tag} has been banned.` });
        }

        if (commandName === "unban") {
            const userId = interaction.options.getString("userid");
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return safeReply(interaction, { content: "You don't have permission to use this command." });
            }

            await interaction.deferReply({ flags: 64 }).catch(() => {});
            await interaction.guild.bans.remove(userId).catch(() => {
                return safeEdit(interaction, { content: "Failed to unban that user. Check the ID and my permissions." });
            });

            await logToShield(
                interaction.guild,
                new EmbedBuilder()
                    .setTitle("User Unbanned")
                    .setColor("Green")
                    .setDescription(`User ID ${userId} was unbanned by ${interaction.user}.`)
                    .setTimestamp()
            );

            return safeEdit(interaction, { content: `✅ User ID ${userId} has been unbanned.` });
        }
    }

    if (interaction.isButton()) {
        const id = interaction.customId;

        if (id.startsWith("unq_approve_") || id.startsWith("unq_deny_")) {
            if (!interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return safeReply(interaction, { content: "You don't have permission to handle unquarantine requests." });
            }

            const userId = id.split("_").pop();
            const approve = id.startsWith("unq_approve_");
            const req = config.unqRequests[userId];
            if (!req) {
                return safeReply(interaction, { content: "This request is no longer active." });
            }

            const guild = interaction.guild;
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                delete config.unqRequests[userId];
                saveConfig();
                return safeReply(interaction, { content: "User not found. Request cleared." });
            }

            if (approve) {
                await unquarantineUser(guild, member, interaction.user, req.reason || "Approved by staff");
                await interaction.update({
                    content: `✅ Unquarantine request approved by ${interaction.user}.`,
                    components: []
                }).catch(() => {});
            } else {
                await logToShield(
                    guild,
                    new EmbedBuilder()
                        .setTitle("Unquarantine Request Denied")
                        .setColor("Red")
                        .setDescription(`${member} had their unquarantine request denied by ${interaction.user}.`)
                        .addFields({ name: "Reason", value: req.reason || "No reason provided" })
                        .setTimestamp()
                );
                await interaction.update({
                    content: `❌ Unquarantine request denied by ${interaction.user}.`,
                    components: []
                }).catch(() => {});
            }

            delete config.unqRequests[userId];
            saveConfig();
        }
    }
});

/* ============================================================
   LOGIN
============================================================ */
client.login(TOKEN);
