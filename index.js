// =======================
// CyberShield - All-in-One Security & Moderation Bot
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
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require("discord.js");
const express = require("express");
const { MessageFlags } = require('discord.js');


process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
});

// -----------------------
// 1. Keep-Alive Web Server
// -----------------------
const app = express();
app.get("/", (req, res) => res.send("CyberShield Active"));
app.listen(process.env.PORT || 3000, () =>
    console.log("Keep-alive server running")
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
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const guildConfig = new Collection();
const spamTracker = new Collection();
const raidTracker = new Collection();
const channelCreateTracker = new Collection();
const roleCreateTracker = new Collection();
const emojiCreateTracker = new Collection();
const threadCreateTracker = new Collection();
const webhookCreateTracker = new Collection();
const panelEditSessions = new Collection();
const setupLocks = new Set();

const WHITELIST = ["876731494805155851"]; // your IDs here
const UNQUARANTINE_REQUEST_COMMANDS = new Set([
    "unquarantine_request"
]);
// -----------------------
// 3. Slash Commands
// -----------------------
const commands = [
    new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Setup staff role, logs, quarantine and request system")
        .addRoleOption(o =>
            o.setName("staff_role")
             .setDescription("Staff/admin role")
             .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // Moderation core
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
        ),

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
        ),

    new SlashCommandBuilder()
        .setName("softban")
        .setDescription("Softban a user (ban, delete messages, unban)")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to softban")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for softban")
             .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Timeout a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to timeout")
             .setRequired(true)
        )
        .addIntegerOption(o =>
            o.setName("minutes")
             .setDescription("Duration in minutes")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for timeout")
             .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("untimeout")
        .setDescription("Remove timeout from a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to untimeout")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("mute")
        .setDescription("Mute a user (Muted role)")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to mute")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for mute")
             .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unmute")
        .setDescription("Unmute a user (Muted role)")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to unmute")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to warn")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for warning")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("View warnings for a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to view warnings for")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("clearwarnings")
        .setDescription("Clear all warnings for a user")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to clear warnings for")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("lock")
        .setDescription("Lock the current channel"),

    new SlashCommandBuilder()
        .setName("unlock")
        .setDescription("Unlock the current channel"),

    new SlashCommandBuilder()
        .setName("slowmode")
        .setDescription("Set slowmode for the current channel")
        .addIntegerOption(o =>
            o.setName("seconds")
             .setDescription("Slowmode in seconds (0 to disable)")
             .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("purge")
        .setDescription("Bulk delete messages in this channel")
        .addIntegerOption(o =>
            o.setName("amount")
             .setDescription("Number of messages (1-100)")
             .setRequired(true)
        ),

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
        ),

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
        ),

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
        ),

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
        ),

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
        ),

    new SlashCommandBuilder()
        .setName("quarantine")
        .setDescription("Place a user into quarantine")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to quarantine")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for quarantine")
             .setRequired(false)
        ),



const commands = [
    new SlashCommandBuilder()
        .setName("unquarantine")
        .setDescription("Remove a user from quarantine")
        .addUserOption(o =>
            o.setName("user")
             .setDescription("User to unquarantine")
             .setRequired(true)
        )
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Reason for unquarantine")
             .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("unquarantine_request")
        .setDescription("Request to be unquarantined (quarantine channel only)")
        .addStringOption(o =>
            o.setName("reason")
             .setDescription("Explain why you should be unquarantined")
             .setRequired(true)
        )
];


// CONFIG SYSTEM (FIXED STRUCTURE)
if (!cfg) {
    cfg = {
        staffRoleId: null,
        logChannelId: null,
        quarantineRoleId: null,
        quarantineChannelId: null,
        unquarantineRequestsChannelId: null,
        mutedRoleId: null,

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
        },

        security: {
            antiRaidEnabled: true,
            antiNukeEnabled: true,
            antiSpamEnabled: true,
            spamMessages: 5,
            spamWindowMs: 3000,
            antiMassMentionEnabled: true,
            antiBotJoinEnabled: true,
            antiAttachmentEnabled: true,
            antiInviteEnabled: true,
            antiChannelSpamEnabled: true,
            antiRoleSpamEnabled: true,
            antiEmojiSpamEnabled: true,
            antiWebhookEnabled: true,
            antiWebhookSpamEnabled: true,
            antiThreadSpamEnabled: true,
            antiGhostPingEnabled: true,
            autoQuarantineEnabled: true,
            publicAlertsEnabled: true
        },

        roleHistory: new Map(),
        warnings: new Map()
    };

    guildConfig.set(guild.id, cfg);
}

return cfg;
function getPriorityColor(priority) {
    if (priority === "high") return 0xff0000;
    if (priority === "low") return 0x57f287;
    return 0xf1c40f;
}

async function sendLog(guild, title, desc, user = null, priority = "medium") {
    const cfg = getGuildConfig(guild);
    if (!cfg.logChannelId) return;

    const channel = guild.channels.cache.get(cfg.logChannelId) ||
        await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(getPriorityColor(priority))
        .setTimestamp();

    if (user) embed.setFooter({ text: `User ID: ${user.id}` });

    await channel.send({ embeds: [embed] }).catch(() => null);
}

async function sendPublicAlert(channel, guild, summary) {
    const cfg = getGuildConfig(guild);
    if (!cfg.logChannelId || !cfg.security.publicAlertsEnabled) return;

    const lines = [
        "**CyberShield Alert**",
        summary,
        "",
        `View full details in <#${cfg.logChannelId}>`
    ];

    const embed = new EmbedBuilder()
        .setDescription(lines.join("\n"))
        .setColor(0x5865f2)
        .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (!msg) return;
    setTimeout(() => msg.delete().catch(() => null), 4 * 60 * 1000);
}

async function sendTempNotice(channel, content, options = {}) {
    const msg = await channel.send({ content, ...options }).catch(() => null);
    if (!msg) return;
    setTimeout(() => msg.delete().catch(() => null), 4 * 60 * 1000);
}

// Role history helpers
function saveRoleHistory(cfg, member) {
    const roles = member.roles.cache
        .filter(r => r.id !== member.guild.id)
        .map(r => r.id);
    cfg.roleHistory.set(member.id, roles);
}

async function restoreRoleHistory(cfg, member) {
    const roles = cfg.roleHistory.get(member.id);
    if (!roles || !roles.length) return;
    const guild = member.guild;
    const validRoles = roles
        .map(id => guild.roles.cache.get(id))
        .filter(r => !!r);
    for (const role of validRoles) {
        await member.roles.add(role).catch(() => null);
    }
    cfg.roleHistory.delete(member.id);
}

// Quarantine apply helper
async function applyQuarantine(cfg, member, mode = "auto") {
    const guild = member.guild;
    const qRole = guild.roles.cache.get(cfg.quarantineRoleId);
    const qChannel = guild.channels.cache.get(cfg.quarantineChannelId);
    if (!qRole || !qChannel) return;

    saveRoleHistory(cfg, member);

    const rolesToRemove = member.roles.cache.filter(r => r.id !== guild.id && r.id !== qRole.id);
    for (const role of rolesToRemove.values()) {
        await member.roles.remove(role).catch(() => null);
    }
    if (!member.roles.cache.has(qRole.id)) {
        await member.roles.add(qRole).catch(() => null);
    }

    let lines;
    if (mode === "auto") {
        lines = [
            "**Quarantine Notice**",
            "You have been placed in quarantine due to security concerns.",
            "This action was taken automatically by CyberShield.",
            "",
            "What this means:",
            "- Your access to the server is temporarily restricted.",
            "- Staff will review your account and activity.",
            "",
            "What you should do now:",
            "- Stay in this channel and read any messages from staff.",
            "- Use `/unquarantine_request` to explain why you should be reviewed.",
            "",
            "Staff will typically look at:",
            "- Account age and history.",
            "- Recent behaviour and messages.",
            "- Any links, invites or suspicious activity.",
            "",
            `For more information about CyberShield, visit: ${WEBSITE_URL}`
        ];
    } else {
        lines = [
            "**Quarantine Notice**",
            "You’re currently in quarantine.",
            "A staff member placed you here for security review.",
            "",
            "What this means:",
            "- Your access to the server is limited while checks are done.",
            "- This is not a permanent punishment unless staff decide so.",
            "",
            "What you should do now:",
            "- Stay respectful and follow any instructions from staff.",
            "- Use `/unquarantine_request` in this channel to explain your situation.",
            "",
            "Helpful tips:",
            "- Be honest and clear in your request.",
            "- Mention if you joined for a specific reason (friend, event, etc.).",
            "",
            `CyberShield is protecting this server. Learn more: ${WEBSITE_URL}`
        ];
    }

    const embed = new EmbedBuilder()
        .setDescription(lines.join("\n"))
        .setColor(0xff0000)
        .setTimestamp();

    const msg = await qChannel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
    if (msg) {
        setTimeout(() => msg.delete().catch(() => null), 4 * 60 * 1000);
    }
}

// Warnings helpers
function addWarning(cfg, userId, data) {
    if (!cfg.warnings.has(userId)) cfg.warnings.set(userId, []);
    cfg.warnings.get(userId).push(data);
}

function getWarnings(cfg, userId) {
    return cfg.warnings.get(userId) || [];
}

function clearWarnings(cfg, userId) {
    cfg.warnings.delete(userId);
}

// -----------------------
// 5. Settings Dashboard Helpers
// -----------------------
function buildSecuritySummary(security) {
    return [
        `Anti-Raid: ${security.antiRaidEnabled ? "On" : "Off"}`,
        `Anti-Nuke: ${security.antiNukeEnabled ? "On" : "Off"}`,
        `Anti-Spam: ${security.antiSpamEnabled ? "On" : "Off"} (${security.spamMessages} msgs / ${security.spamWindowMs / 1000}s)`,
        `Anti-Mass-Mention: ${security.antiMassMentionEnabled ? "On" : "Off"}`,
        `Anti-Bot-Join: ${security.antiBotJoinEnabled ? "On" : "Off"}`,
        `Anti-Attachment: ${security.antiAttachmentEnabled ? "On" : "Off"}`,
        `Anti-Invite: ${security.antiInviteEnabled ? "On" : "Off"}`,
        `Anti-Webhook: ${security.antiWebhookEnabled ? "On" : "Off"}`,
        `Anti-Webhook-Spam: ${security.antiWebhookSpamEnabled ? "On" : "Off"}`,
        `Anti-Channel-Spam: ${security.antiChannelSpamEnabled ? "On" : "Off"}`,
        `Anti-Role-Spam: ${security.antiRoleSpamEnabled ? "On" : "Off"}`,
        `Anti-Emoji-Spam: ${security.antiEmojiSpamEnabled ? "On" : "Off"}`,
        `Anti-Thread-Spam: ${security.antiThreadSpamEnabled ? "On" : "Off"}`,
        `Anti-Ghost-Ping: ${security.antiGhostPingEnabled ? "On" : "Off"}`,
        `Auto-Quarantine: ${security.autoQuarantineEnabled ? "On" : "Off"}`,
        `Public Alerts: ${security.publicAlertsEnabled ? "On" : "Off"}`
    ].join("\n");
}

function buildPanelEmbed(guild, cfg, editing = false, draftSecurity = null) {
    const sec = draftSecurity || cfg.security;
    const lines = [
        "Recommended settings:",
        "- Anti-Raid: On",
        "- Anti-Nuke: On",
        "- Anti-Spam: On (5 msgs / 3s)",
        "- Anti-Mass-Mention: On",
        "- Anti-Bot-Join: On",
        "- Anti-Attachment: On",
        "- Anti-Channel/Role/Emoji/Webhook/Thread Spam: On",
        "- Anti-Ghost-Ping: On",
        "",
        `Website: ${WEBSITE_URL}`
    ];

    return new EmbedBuilder()
        .setTitle(`CyberShield Settings Dashboard${editing ? " (Editing)" : ""}`)
        .setDescription(lines.join("\n"))
        .addFields({
            name: "Current Security Profile",
            value: buildSecuritySummary(sec)
        })
        .setColor(editing ? 0xf1c40f : 0x57f287)
        .setTimestamp();
}

function buildPanelButtons(editing = false) {
    if (!editing) {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("panel_edit")
                    .setLabel("Edit")
                    .setStyle(ButtonStyle.Primary)
            )
        ];
    }

    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("panel_toggle_antiraid").setLabel("Anti-Raid").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_antinuke").setLabel("Anti-Nuke").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_antispam").setLabel("Anti-Spam").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_spam_minus").setLabel("- Spam Msgs").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_spam_plus").setLabel("+ Spam Msgs").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("panel_toggle_massmention").setLabel("Anti-Mass-Mention").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_botjoin").setLabel("Anti-Bot-Join").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_attachment").setLabel("Anti-Attachment").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_invite").setLabel("Anti-Invite").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_webhook").setLabel("Anti-Webhook").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("panel_toggle_webhookspam").setLabel("Anti-Webhook-Spam").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_channelspam").setLabel("Anti-Channel-Spam").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_rolespam").setLabel("Anti-Role-Spam").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_emojispam").setLabel("Anti-Emoji-Spam").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_threadspam").setLabel("Anti-Thread-Spam").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("panel_toggle_ghostping").setLabel("Anti-Ghost-Ping").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_autoquarantine").setLabel("Auto-Quarantine").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_toggle_publicalerts").setLabel("Public Alerts").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("panel_save").setLabel("Save").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("panel_cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger)
        )
    ];
}

// -----------------------
// 6. Ready & Command Registration
// -----------------------
client.once("ready", async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log("Slash commands registered globally.");
    } catch (err) {
        console.error("Failed to register commands:", err);
    }
});

// Hi message every time the bot joins a server
client.on("guildCreate", async (guild) => {
    const cfg = getGuildConfig(guild);
    const systemChannel = guild.systemChannel || guild.channels.cache.find(c => c.type === ChannelType.GuildText);
    if (!systemChannel) return;

    const lines = [
        "CyberShield has joined this server.",
        "",
        "Recommended settings:",
        "- #IMPORTANT **Make sure the bots role is high so moderation commands work**",
        "- Give CyberShield Administrator or strong moderation permissions.",
        "- Run /setup to link your staff role and create logs and quarantine.",
        "- Keep Anti-Raid, Anti-Nuke, Anti-Spam, Anti-Mass-Mention and Webhook Guard enabled.",
        "",
        "Core protections:",
        "- Raid detection and automatic server freeze.",
        "- Channel delete protection and rogue staff mitigation.",
        "- Webhook and invite blocking for non-staff.",
        "- Quarantine system for suspicious accounts.",
        "",
        `Dashboard and info: ${WEBSITE_URL}`
    ];

    const embed = new EmbedBuilder()
        .setTitle("CyberShield Setup and Recommended Settings")
        .setDescription(lines.join("\n"))
        .setColor(0x5865f2);

    systemChannel.send({ embeds: [embed] }).catch(() => null);

    if (!cfg.welcome.channelId) {
        cfg.welcome.channelId = systemChannel.id;
    }
});

// -----------------------
// 7. Interaction Handler
// -----------------------
client.on("interactionCreate", async (int) => {
    if (int.isButton()) {
        return handleButtonInteraction(int);
    }

    if (!int.isChatInputCommand() || !int.guild) return;

    const cfg = getGuildConfig(int.guild);

    const isOwner = int.user.id === int.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(int.user.id);
    const isAdminPerm = int.member.permissions.has(PermissionFlagsBits.Administrator);
    const isStaff = cfg.staffRoleId && int.member.roles.cache.has(cfg.staffRoleId);

    const staffCommands = [
        "kick", "ban", "softban", "timeout", "untimeout",
        "mute", "unmute", "warn", "warnings", "clearwarnings",
        "lock", "unlock", "slowmode",
        "purge", "freeze", "unfreeze",
        "roleadd", "roleremove", "welcomeconfig",
        "quarantine", "unquarantine",
        "shieldpanel"
    ];

    const isSetup = int.commandName === "setup";
    const isUnquarantineRequestCommand = UNQUARANTINE_REQUEST_COMMANDS.has(int.commandName);
    const isStaffCommand = staffCommands.includes(int.commandName);

    if (isSetup) {
        if (!(isOwner || isWhitelisted || isAdminPerm)) {
            return int.reply({ content: "❌ You are not authorized to use /setup.", flags: MessageFlags.Ephemeral });
        }
    } else if (isStaffCommand) {
        if (!(isOwner || isWhitelisted || isStaff)) {
            return int.reply({ content: "❌ You must have the staff role to use this command.", flags: MessageFlags.Ephemeral });
        }
    }

    try {
        // SETUP
        if (int.commandName === "setup") {
            const role = int.options.getRole("staff_role");

            // Logs channel (duplicate-proof)
            let logChannel = null;
            if (cfg.logChannelId) {
                logChannel = int.guild.channels.cache.get(cfg.logChannelId)
                    // SETUP
        if (int.commandName === "setup") {
            if (setupLocks.has(int.guild.id)) {
                return int.reply({ content: "Setup is already running for this server. Please wait a few seconds and try again.", flags: MessageFlags.Ephemeral });
            }

            setupLocks.add(int.guild.id);

            try {
                const role = int.options.getRole("staff_role");

                await int.guild.channels.fetch().catch(() => null);
                await int.guild.roles.fetch().catch(() => null);

                // Logs channel (duplicate-proof)
                let logChannel = null;
                            id: role.id,
                            allow: [PermissionsBitField.Flags.ViewChannel]
                        }
                    ]
                });
            }
            cfg.logChannelId = logChannel.id;

            // Quarantine role (duplicate-proof)
            let qRole = null;
            if (cfg.quarantineRoleId) {
                qRole = int.guild.roles.cache.get(cfg.quarantineRoleId)
                    || await int.guild.roles.fetch(cfg.quarantineRoleId).catch(() => null);
            }
            if (!qRole) {
                qRole = int.guild.roles.cache.find(r => r.name === "Quarantined");
            }
            if (!qRole) {
                qRole = await int.guild.roles.create({
                    name: "Quarantined",
                    colors: ['#0xff0000']
                    reason: "CyberShield Quarantine Role"
                });
            }
            cfg.quarantineRoleId = qRole.id;

          
            // Quarantine channel (duplicate-proof)
            let qChannel = null;
            if (cfg.quarantineChannelId) {
                qChannel = int.guild.channels.cache.get(cfg.quarantineChannelId)
                    || await int.guild.channels.fetch(cfg.quarantineChannelId).catch(() => null);
            }
            if (!qChannel) {
                qChannel = int.guild.channels.cache.find(
                    c => c.name === "quarantine-hold" && c.type === ChannelType.GuildText
                );
            }
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
                        },
                        {
                            id: role.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                        }
                    ]
                });
            }
            cfg.quarantineChannelId = qChannel.id;

            // Unquarantine requests channel (duplicate-proof)
            let reqChannel = null;
            if (cfg.unquarantineRequestsChannelId) {
                reqChannel = int.guild.channels.cache.get(cfg.unquarantineRequestsChannelId)
                    || await int.guild.channels.fetch(cfg.unquarantineRequestsChannelId).catch(() => null);
            }
            if (!reqChannel) {
                reqChannel = int.guild.channels.cache.find(
                    c => c.name === "unquarantine-requests" && c.type === ChannelType.GuildText
                );
            }
            if (!reqChannel) {
                reqChannel = await int.guild.channels.create({
                    name: "unquarantine-requests",
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: int.guild.roles.everyone.id,
                            deny: [PermissionsBitField.Flags.ViewChannel]
                        },
                        {
                            id: role.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages]
                        }
                    ]
                });
            }
            cfg.unquarantineRequestsChannelId = reqChannel.id;

            // Muted role (for mute command)
            let mutedRole = null;
            if (cfg.mutedRoleId) {
                mutedRole = int.guild.roles.cache.get(cfg.mutedRoleId)
                    || await int.guild.roles.fetch(cfg.mutedRoleId).catch(() => null);
            }
            if (!mutedRole) {
                mutedRole = int.guild.roles.cache.find(r => r.name === "Muted");
            }
            if (!mutedRole) {
                mutedRole = await int.guild.roles.create({
                    name: "Muted",
                    colors: ['#0x808080'],
                    reason: "CyberShield Muted Role"
                });
            }
            cfg.mutedRoleId = mutedRole.id;
            cfg.staffRoleId = role.id;

            guildConfig.set(int.guild.id, cfg);

            await int.reply(
                "Setup complete.\n" +
                `Staff Role: <@&${role.id}>\n` +
                `Logs: <#${logChannel.id}>\n` +
                `Quarantine Role: <@&${qRole.id}>\n` +
                `Quarantine Channel: <#${qChannel.id}>\n` +
                `Unquarantine Requests: <#${reqChannel.id}>\n` +
                `Muted Role: <@&${mutedRole.id}>`
            );
            await sendLog(int.guild, "Setup Completed", `Setup run by ${int.user.tag}`, int.user, "medium");
        }

        // MODERATION COMMANDS

        if (int.commandName === "kick") {
            const target = int.options.getMember("user");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!target) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
            if (!target.kickable) return int.reply({ content: "❌ I cannot kick this user.", flags: MessageFlags.Ephemeral });

            await target.kick(reason);
            await int.reply(`Kicked ${target.user.tag}\nReason: ${reason}`);
            await sendLog(int.guild, "User Kicked", `${target.user.tag} was kicked by ${int.user.tag}\nReason: ${reason}`, target.user, "low");
        }

        if (int.commandName === "ban") {
            const targetUser = int.options.getUser("user");
                     await sendLog(int.guild, "Setup Completed", `Setup run by ${int.user.tag}`, int.user, "medium");
            } finally {
                setupLocks.delete(int.guild.id);
            }
        }
            const reason = int.options.getString("reason") || "No reason provided";

            if (!target) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
            if (!target.bannable) return int.reply({ content: "❌ I cannot ban this user.", flags: MessageFlags.Ephemeral });

            await target.ban({ reason });
            await int.reply(`Banned ${target.user.tag}\nReason: ${reason}`);
            await sendLog(int.guild, "User Banned", `${target.user.tag} was banned by ${int.user.tag}\nReason: ${reason}`, target.user, "high");
        }

        if (int.commandName === "softban") {
            const targetUser = int.options.getUser("user");
            const reason = int.options.getString("reason") || "No reason provided";

            const member = int.guild.members.cache.get(targetUser.id) ||
                await int.guild.members.fetch(targetUser.id).catch(() => null);
            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
            if (!member.bannable) return int.reply({ content: "❌ I cannot softban this user.", flags: MessageFlags.Ephemeral });

            await member.ban({ reason, deleteMessageSeconds: 7 * 24 * 60 * 60 }).catch(() => null);
            await int.guild.members.unban(targetUser.id, "Softban unban").catch(() => null);

            await int.reply(`Softbanned ${targetUser.tag}\nReason: ${reason}`);
            await sendLog(int.guild, "User Softbanned", `${targetUser.tag} softbanned by ${int.user.tag}\nReason: ${reason}`, targetUser, "high");
        }

        if (int.commandName === "timeout") {
            const member = int.options.getMember("user");
            const minutes = int.options.getInteger("minutes");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
            if (!member.moderatable) return int.reply({ content: "❌ I cannot timeout this user.", flags: MessageFlags.Ephemeral });

            const ms = Math.max(1, minutes) * 60 * 1000;
            await member.timeout(ms, reason).catch(() => null);

            await int.reply(`Timed out ${member.user.tag} for ${minutes} minute(s).\nReason: ${reason}`);
            await sendLog(int.guild, "User Timed Out", `${member.user.tag} timed out by ${int.user.tag} for ${minutes} minute(s)\nReason: ${reason}`, member.user, "medium");
        }

        if (int.commandName === "untimeout") {
            const member = int.options.getMember("user");
            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            await member.timeout(null, "Timeout removed").catch(() => null);
            await int.reply(`Removed timeout from ${member.user.tag}.`);
            await sendLog(int.guild, "Timeout Removed", `${member.user.tag} timeout removed by ${int.user.tag}`, member.user, "low");
        }

        if (int.commandName === "mute") {
            const member = int.options.getMember("user");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            let mutedRole = int.guild.roles.cache.get(cfg.mutedRoleId);
            if (!mutedRole) {
                mutedRole = int.guild.roles.cache.find(r => r.name === "Muted");
                if (!mutedRole) {
                    mutedRole = await int.guild.roles.create({
                        name: "Muted",
                        colors: ['#0x808080'],
                        reason: "CyberShield Muted Role"
                    });
                }
                cfg.mutedRoleId = mutedRole.id;
            }

            await member.roles.add(mutedRole).catch(() => null);
            await int.reply(`Muted ${member.user.tag}.\nReason: ${reason}`);
            await sendLog(int.guild, "User Muted", `${member.user.tag} muted by ${int.user.tag}\nReason: ${reason}`, member.user, "medium");
        }

        if (int.commandName === "unmute") {
            const member = int.options.getMember("user");
            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            const mutedRole = int.guild.roles.cache.get(cfg.mutedRoleId) ||
                int.guild.roles.cache.find(r => r.name === "Muted");
            if (!mutedRole) return int.reply({ content: "Muted role not found.", flags: MessageFlags.Ephemeral });

            await member.roles.remove(mutedRole).catch(() => null);
            await int.reply(`Unmuted ${member.user.tag}.`);
            await sendLog(int.guild, "User Unmuted", `${member.user.tag} unmuted by ${int.user.tag}`, member.user, "low");
        }

        if (int.commandName === "warn") {
            const member = int.options.getMember("user");
            const reason = int.options.getString("reason");

            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            const data = {
                reason,
                by: int.user.id,
                at: Date.now()
            };
            addWarning(cfg, member.id, data);

            await int.reply(`Warned ${member.user.tag}.\nReason: ${reason}`);
            await sendLog(int.guild, "User Warned", `${member.user.tag} warned by ${int.user.tag}\nReason: ${reason}`, member.user, "medium");
        }

        if (int.commandName === "warnings") {
            const member = int.options.getMember("user");
            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            const warns = getWarnings(cfg, member.id);
            if (!warns.length) {
                return int.reply({ content: `${member.user.tag} has no warnings.`, flags: MessageFlags.Ephemeral });
            }

            const lines = warns.map((w, i) => {
                const by = int.guild.members.cache.get(w.by)?.user.tag || w.by;
                const date = new Date(w.at).toLocaleString();
                return `**#${i + 1}** - by ${by} on ${date}\nReason: ${w.reason}`;
            });

            const embed = new EmbedBuilder()
                .setTitle(`Warnings for ${member.user.tag}`)
                .setDescription(lines.join("\n\n"))
                .setColor(0xf1c40f);

            await int.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (int.commandName === "clearwarnings") {
            const member = int.options.getMember("user");
            if (!member) return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });

            clearWarnings(cfg, member.id);
            await int.reply(`Cleared all warnings for ${member.user.tag}.`);
            await sendLog(int.guild, "Warnings Cleared", `All warnings for ${member.user.tag} cleared by ${int.user.tag}`, member.user, "low");
        }

        if (int.commandName === "lock") {
            await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                SendMessages: false
            }).catch(() => null);
            await int.reply("This channel has been locked. Only staff can speak.");
            await sendLog(int.guild, "Channel Locked", `${int.user.tag} locked #${int.channel.name}`, int.user, "medium");
        }

        if (int.commandName === "unlock") {
            await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                SendMessages: null
            }).catch(() => null);
            await int.reply("This channel has been unlocked.");
            await sendLog(int.guild, "Channel Unlocked", `${int.user.tag} unlocked #${int.channel.name}`, int.user, "low");
        }

        if (int.commandName === "slowmode") {
            const seconds = int.options.getInteger("seconds");
            if (seconds < 0 || seconds > 21600) {
                return int.reply({ content: "Slowmode must be between 0 and 21600 seconds.", flags: MessageFlags.Ephemeral });
            }

            await int.channel.setRateLimitPerUser(seconds, `Set by ${int.user.tag}`).catch(() => null);
            await int.reply(`Slowmode set to ${seconds} second(s).`);
            await sendLog(int.guild, "Slowmode Changed", `${int.user.tag} set slowmode in #${int.channel.name} to ${seconds}s`, int.user, "low");
        }

        if (int.commandName === "purge") {
            const amount = int.options.getInteger("amount");
            if (amount < 1 || amount > 100) {
                return int.reply({ content: "Amount must be between 1 and 100.", flags: MessageFlags.Ephemeral });
            }

            const deleted = await int.channel.bulkDelete(amount, true).catch(() => null);
            const count = deleted ? deleted.size : 0;

            await int.reply({ content: `Cleared ${count} messages.`, flags: MessageFlags.Ephemeral });
            await sendLog(int.guild, "Messages Purged", `${int.user.tag} purged ${count} messages in #${int.channel.name}`, int.user, "low");
        }

        if (int.commandName === "freeze") {
            const scope = int.options.getString("scope");

            if (scope === "channel") {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                    SendMessages: false
                });
                cfg.frozen.channels.add(int.channel.id);
                await int.reply("This channel has been frozen. Only staff can speak.");
                await sendLog(int.guild, "Channel Frozen", `${int.user.tag} froze #${int.channel.name}`, int.user, "medium");
            } else {
                cfg.frozen.server = true;
                for (const ch of int.guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
                        await ch.permissionOverwrites.edit(int.guild.roles.everyone, {
                            SendMessages: false
                        }).catch(() => null);
                    }
                }
                await int.reply("Server frozen. Only staff can speak.");
                await sendLog(int.guild, "Server Frozen", `${int.user.tag} froze the server`, int.user, "high");
            }
        }

        if (int.commandName === "unfreeze") {
            const scope = int.options.getString("scope");

            if (scope === "channel") {
                await int.channel.permissionOverwrites.edit(int.guild.roles.everyone, {
                    SendMessages: null
                });
                cfg.frozen.channels.delete(int.channel.id);
                await int.reply("This channel has been unfrozen.");
                await sendLog(int.guild, "Channel Unfrozen", `${int.user.tag} unfroze #${int.channel.name}`, int.user, "low");
            } else {
                cfg.frozen.server = false;
                for (const ch of int.guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement) {
                        await ch.permissionOverwrites.edit(int.guild.roles.everyone, {
                            SendMessages: null
                        }).catch(() => null);
                    }
                }
                await int.reply("Server unfrozen.");
                await sendLog(int.guild, "Server Unfrozen", `${int.user.tag} unfroze the server`, int.user, "medium");
            }
        }

        if (int.commandName === "roleadd") {
            const member = int.options.getMember("user");
            const role = int.options.getRole("role");

            if (!member || !role) {
                return int.reply({ content: "Invalid user or role.", flags: MessageFlags.Ephemeral });
            }

            if (!int.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return int.reply({ content: "❌ I need Manage Roles permission.", flags: MessageFlags.Ephemeral });
            }

            await member.roles.add(role).catch(() => null);
            await int.reply(`Added role <@&${role.id}> to ${member.user.tag}.`);
            await sendLog(int.guild, "Role Added", `${int.user.tag} added role ${role.name} to ${member.user.tag}`, int.user, "low");
        }

        if (int.commandName === "roleremove") {
            const member = int.options.getMember("user");
            const role = int.options.getRole("role");

            if (!member || !role) {
                return int.reply({ content: "Invalid user or role.", flags: MessageFlags.Ephemeral });
            }

            if (!int.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
                return int.reply({ content: "❌ I need Manage Roles permission.", flags: MessageFlags.Ephemeral });
            }

            await member.roles.remove(role).catch(() => null);
            await int.reply(`Removed role <@&${role.id}> from ${member.user.tag}.`);
            await sendLog(int.guild, "Role Removed", `${int.user.tag} removed role ${role.name} from ${member.user.tag}`, int.user, "low");
        }

        if (int.commandName === "welcomeconfig") {
            const channel = int.options.getChannel("channel");
            const style = int.options.getString("style");
            const text = int.options.getString("text");
            const maxLines = int.options.getInteger("max_lines");
            const enabled = int.options.getBoolean("enabled");

            if (channel && channel.type !== ChannelType.GuildText) {
                return int.reply({ content: "Channel must be a text channel.", flags: MessageFlags.Ephemeral });
            }

            if (channel) cfg.welcome.channelId = channel.id;
            if (style) cfg.welcome.style = style;
            if (typeof enabled === "boolean") cfg.welcome.enabled = enabled;
            if (text) cfg.welcome.customText = text;
            if (maxLines) cfg.welcome.maxLines = Math.max(1, Math.min(15, maxLines));

            guildConfig.set(int.guild.id, cfg);

            await int.reply(
                "Welcome configuration updated:\n" +
                `Enabled: ${cfg.welcome.enabled}\n` +
                `Channel: ${cfg.welcome.channelId ? `<#${cfg.welcome.channelId}>` : "Not set"}\n` +
                `Style: ${cfg.welcome.style}\n` +
                `Max Lines: ${cfg.welcome.maxLines}`
            );
        }

        if (int.commandName === "quarantine") {
            const member = int.options.getMember("user");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!cfg.quarantineRoleId || !cfg.quarantineChannelId) {
                return int.reply({ content: "Quarantine system is not configured. Run /setup.", flags: MessageFlags.Ephemeral });
            }

            const qChannel = int.guild.channels.cache.get(cfg.quarantineChannelId);

            if (!member || !qChannel) {
                return int.reply({ content: "Quarantine role or channel is missing.", flags: MessageFlags.Ephemeral });
            }

            await applyQuarantine(cfg, member, "staff");
            await qChannel.send(
                `${member} has been placed in quarantine by staff. Reason: ${reason}`
            ).catch(() => null);

            await int.reply(`User ${member.user.tag} has been quarantined.`);
            await sendLog(int.guild, "User Quarantined", `${member.user.tag} quarantined by ${int.user.tag}\nReason: ${reason}`, member.user, "high");
        }

        if (int.commandName === "unquarantine") {
            const member = int.options.getMember("user");
            const reason = int.options.getString("reason") || "No reason provided";

            if (!cfg.quarantineRoleId) {
                return int.reply({ content: "Quarantine system is not configured. Run /setup.", flags: MessageFlags.Ephemeral });
            }

            const qRole = int.guild.roles.cache.get(cfg.quarantineRoleId);
            if (!member || !qRole) {
                return int.reply({ content: "Quarantine role or user is missing.", flags: MessageFlags.Ephemeral });
            }

            await member.roles.remove(qRole).catch(() => null);
            await restoreRoleHistory(cfg, member);

            await int.reply(`User ${member.user.tag} has been unquarantined.`);

            // Strict DM
            try {
                const dmEmbed = new EmbedBuilder()
                    .setTitle("Your Quarantine Has Been Lifted")
                    .setDescription(
                        "Your quarantine has been lifted by server staff.\n\n" +
                        "This action was performed manually and may not indicate approval of a previous request.\n" +
                        "Please ensure you follow all server rules and avoid any behaviour that may trigger CyberShield’s security systems."
                    )
                    .setColor(0xf1c40f)
                    .setTimestamp();

                await member.send({ embeds: [dmEmbed] }).catch(() => null);
            } catch {}

            await sendLog(
                int.guild,
                "User Unquarantined (Manual)",
                `${member.user.tag} was unquarantined by ${int.user.tag}\nReason: ${reason}`,
                member.user,
                "medium"
            );
        }

        

        if (isUnquarantineRequestCommand) {
            if (!cfg.quarantineRoleId || !cfg.quarantineChannelId || !cfg.unquarantineRequestsChannelId) {
                return int.reply({ content: "Quarantine system is not configured. Ask staff to run /setup.", flags: MessageFlags.Ephemeral });
            }

            const qRole = int.guild.roles.cache.get(cfg.quarantineRoleId)
                || await int.guild.roles.fetch(cfg.quarantineRoleId).catch(() => null);
            const qChannel = int.guild.channels.cache.get(cfg.quarantineChannelId)
                || await int.guild.channels.fetch(cfg.quarantineChannelId).catch(() => null);
            const reqChannel = int.guild.channels.cache.get(cfg.unquarantineRequestsChannelId)
                || await int.guild.channels.fetch(cfg.unquarantineRequestsChannelId).catch(() => null);
            const member = int.member
                || await int.guild.members.fetch(int.user.id).catch(() => null);

            if (!qRole || !qChannel || !reqChannel || !member) {
                return int.reply({ content: "Quarantine system channels or roles are missing.", flags: MessageFlags.Ephemeral });
            }

            if (int.channel.id !== qChannel.id) {
                return int.reply({ content: "You can only use this command in the quarantine channel.", flags: MessageFlags.Ephemeral });
            }

            if (!member.roles.cache.has(qRole.id)) {
                return int.reply({ content: "You must be quarantined to use this command.", flags: MessageFlags.Ephemeral });
            }

            const reason = int.options.getString("reason");

            const embed = new EmbedBuilder()
                .setTitle("Unquarantine Request")
                .setDescription(
                    `User: ${int.user.tag}\n` +
                    `ID: ${int.user.id}\n\n` +
                    `Reason:\n${reason}`
                )
                .setColor(0x3498db)
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`unq_accept_${int.user.id}`)
                    .setLabel("Accept")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`unq_reject_${int.user.id}`)
                    .setLabel("Reject")
                    .setStyle(ButtonStyle.Danger)
            );

            const msg = await reqChannel.send({
                content: `🎫 Unquarantine request from <@${int.user.id}>`,
                embeds: [embed],
                components: [row]
            }).catch(() => null);

            if (!msg) {
                return int.reply({ content: "Could not create request. Please tell staff.", flags: MessageFlags.Ephemeral });
            }

            await int.reply({ content: "Your unquarantine request has been sent to staff.", flags: MessageFlags.Ephemeral });
            await sendLog(int.guild, "Unquarantine Request", `${int.user.tag} submitted an unquarantine request.`, int.user, "medium");
        }

        if (int.commandName === "shieldpanel") {
            const embed = buildPanelEmbed(int.guild, cfg, false);
            const rows = buildPanelButtons(false);
            await int.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
        }
    } catch (err) {
        console.error(err);
        if (!int.replied) {
            int.reply({ content: "❌ An error occurred while executing that command.", flags: MessageFlags.Ephemeral }).catch(() => null);
        }
    }
});

// -----------------------
// 8. Button Handler
// -----------------------
async function handleButtonInteraction(int) {
    if (!int.guild) return;
    const cfg = getGuildConfig(int.guild);

    const isOwner = int.user.id === int.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(int.user.id);
    const isStaff = cfg.staffRoleId && int.member.roles.cache.has(cfg.staffRoleId);

    if (!(isOwner || isWhitelisted || isStaff)) {
        return int.reply({ content: "❌ You are not authorized to use this.", flags: MessageFlags.Ephemeral });
    }

    if (int.customId.startsWith("panel_")) {
        const key = `${int.guild.id}-${int.user.id}`;
        let session = panelEditSessions.get(key);

        if (int.customId === "panel_edit") {
            session = {
                draftSecurity: { ...cfg.security }
            };
            panelEditSessions.set(key, session);
            const embed = buildPanelEmbed(int.guild, cfg, true, session.draftSecurity);
            const rows = buildPanelButtons(true);
            return int.update({ embeds: [embed], components: rows });
        }

        if (!session) {
            return int.reply({ content: "No active edit session. Use /shieldpanel again.", flags: MessageFlags.Ephemeral });
        }

        const sec = session.draftSecurity;

        if (int.customId === "panel_toggle_antiraid") sec.antiRaidEnabled = !sec.antiRaidEnabled;
        if (int.customId === "panel_toggle_antinuke") sec.antiNukeEnabled = !sec.antiNukeEnabled;
        if (int.customId === "panel_toggle_antispam") sec.antiSpamEnabled = !sec.antiSpamEnabled;
        if (int.customId === "panel_spam_minus") sec.spamMessages = Math.max(2, sec.spamMessages - 1);
        if (int.customId === "panel_spam_plus") sec.spamMessages = Math.min(20, sec.spamMessages + 1);
        if (int.customId === "panel_toggle_massmention") sec.antiMassMentionEnabled = !sec.antiMassMentionEnabled;
        if (int.customId === "panel_toggle_botjoin") sec.antiBotJoinEnabled = !sec.antiBotJoinEnabled;
        if (int.customId === "panel_toggle_attachment") sec.antiAttachmentEnabled = !sec.antiAttachmentEnabled;
        if (int.customId === "panel_toggle_invite") sec.antiInviteEnabled = !sec.antiInviteEnabled;
        if (int.customId === "panel_toggle_webhook") sec.antiWebhookEnabled = !sec.antiWebhookEnabled;
        if (int.customId === "panel_toggle_webhookspam") sec.antiWebhookSpamEnabled = !sec.antiWebhookSpamEnabled;
        if (int.customId === "panel_toggle_channelspam") sec.antiChannelSpamEnabled = !sec.antiChannelSpamEnabled;
        if (int.customId === "panel_toggle_rolespam") sec.antiRoleSpamEnabled = !sec.antiRoleSpamEnabled;
        if (int.customId === "panel_toggle_emojispam") sec.antiEmojiSpamEnabled = !sec.antiEmojiSpamEnabled;
        if (int.customId === "panel_toggle_threadspam") sec.antiThreadSpamEnabled = !sec.antiThreadSpamEnabled;
        if (int.customId === "panel_toggle_ghostping") sec.antiGhostPingEnabled = !sec.antiGhostPingEnabled;
        if (int.customId === "panel_toggle_autoquarantine") sec.autoQuarantineEnabled = !sec.autoQuarantineEnabled;
        if (int.customId === "panel_toggle_publicalerts") sec.publicAlertsEnabled = !sec.publicAlertsEnabled;

        if (int.customId === "panel_save") {
            cfg.security = { ...sec };
            guildConfig.set(int.guild.id, cfg);
            panelEditSessions.delete(key);
            const embed = buildPanelEmbed(int.guild, cfg, false);
            const rows = buildPanelButtons(false);
            return int.update({ embeds: [embed], components: rows });
        }

        if (int.customId === "panel_cancel") {
            panelEditSessions.delete(key);
            const embed = buildPanelEmbed(int.guild, cfg, false);
            const rows = buildPanelButtons(false);
            return int.update({ embeds: [embed], components: rows });
        }

        const embed = buildPanelEmbed(int.guild, cfg, true, sec);
        const rows = buildPanelButtons(true);
        return int.update({ embeds: [embed], components: rows });
    }

    const [prefix, action, userId] = int.customId.split("_");
    if (prefix !== "unq") return;

    const member = await int.guild.members.fetch(userId).catch(() => null);
    if (!member) {
        return int.reply({ content: "User not found.", flags: MessageFlags.Ephemeral });
    }

    if (!cfg.quarantineRoleId) {
        return int.reply({ content: "Quarantine system is not configured.", flags: MessageFlags.Ephemeral });
    }

    const qRole = int.guild.roles.cache.get(cfg.quarantineRoleId);
    if (!qRole) {
        return int.reply({ content: "Quarantine role is missing.", flags: MessageFlags.Ephemeral });
    }

    if (action === "accept") {
        await member.roles.remove(qRole).catch(() => null);
        await restoreRoleHistory(cfg, member);

        await int.update({
            content: `Request accepted by ${int.user.tag}. User has been unquarantined.`,
            components: []
        }).catch(() => null);

        const qChannel = int.guild.channels.cache.get(cfg.quarantineChannelId);
        if (qChannel) {
            const lines = [
                "**Unquarantine Approved**",
                `${member}, your request has been accepted by staff.`,
                "",
                "You now have full access to the server again.",
                "Please follow all server rules and avoid any behaviour that may trigger security systems.",
                "",
                `CyberShield is active. More info: ${WEBSITE_URL}`
            ];

            const embed = new EmbedBuilder()
                .setDescription(lines.join("\n"))
                .setColor(0x57f287)
                .setTimestamp();

            const msg = await qChannel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
            if (msg) setTimeout(() => msg.delete().catch(() => null), 4 * 60 * 1000);
        }

        // Friendly + neutral DM
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle("Your Unquarantine Request Was Approved")
                .setDescription(
                    "Good news — your unquarantine request has been reviewed and accepted by staff.\n\n" +
                    "You now have full access to the server again.\n" +
                    "Please continue to follow all server rules and guidelines.\n\n" +
                    "If you have any questions, you may contact staff directly."
                )
                .setColor(0x57f287)
                .setTimestamp();

            await member.send({ embeds: [dmEmbed] }).catch(() => null);
        } catch {}

        const systemChannel = int.guild.systemChannel;
        if (systemChannel) {
            await sendPublicAlert(
                systemChannel,
                int.guild,
                `Unquarantine: ${member.user.tag} has been restored to normal access.`
            );
        }

        await sendLog(
            int.guild,
            "Unquarantine Request Accepted",
            `User ${member.user.tag} unquarantined by ${int.user.tag} via request.`,
            member.user,
            "medium"
        );
    } else if (action === "reject") {
        await applyQuarantine(cfg, member, "staff");
        await int.update({
            content: `Request rejected by ${int.user.tag}. User remains quarantined.`,
            components: []
        }).catch(() => null);

        const qChannel = int.guild.channels.cache.get(cfg.quarantineChannelId);
        if (qChannel) {
            const lines = [
                "**Quarantine Update**",
                "Your unquarantine request was reviewed and rejected by staff.",
                "",
                "What you can do:",
                "- Wait some time before submitting another request.",
                "- Make sure you follow all server rules.",
                "- Avoid any behaviour that looks like spam, raids or advertising.",
                "",
                "If you believe this is a mistake, explain clearly in your next request.",
                `CyberShield is protecting this server. More info: ${WEBSITE_URL}`
            ];
            const embed = new EmbedBuilder()
                .setDescription(lines.join("\n"))
                .setColor(0xf1c40f)
                .setTimestamp();

            const msg = await qChannel.send({ content: `${member}`, embeds: [embed] }).catch(() => null);
            if (msg) {
                setTimeout(() => msg.delete().catch(() => null), 4 * 60 * 1000);
            }
        }

        // DM on reject
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle("Your Unquarantine Request Was Rejected")
                .setDescription(
                    "Your unquarantine request has been reviewed and rejected by staff.\n\n" +
                    "You remain in quarantine for now.\n\n" +
                    "What you can do:\n" +
                    "- Wait some time before submitting another request.\n" +
                    "- Make sure you follow all server rules.\n" +
                    "- When you submit another request, be clear and honest about your situation."
                )
                .setColor(0xff0000)
                .setTimestamp();

            await member.send({ embeds: [dmEmbed] }).catch(() => null);
        } catch {}

        await sendLog(
            int.guild,
            "Unquarantine Request Rejected",
            `User ${member.user.tag} request rejected by ${int.user.tag}.`,
            member.user,
            "low"
        );
    }
}

// -----------------------
// 9. Welcome System & Joins
// -----------------------
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cfg = getGuildConfig(guild);

    // Anti-Bot-Join
    if (cfg.security.antiBotJoinEnabled && member.user.bot) {
        if (!WHITELIST.includes(member.user.id)) {
            await member.kick("Anti-Bot-Join: Bot not whitelisted").catch(() => null);
            await sendLog(
                guild,
                "Anti-Bot-Join",
                `Blocked bot ${member.user.tag} from joining (not whitelisted).`,
                member.user,
                "high"
            );
            const ch = guild.systemChannel;
            if (ch) {
                await sendPublicAlert(
                    ch,
                    guild,
                    "Anti-Bot-Join: A bot was blocked from joining. View full details in the logs."
                );
            }
            return;
        }
    }

    // Auto-Quarantine + Age Gate (3 days)
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

    if (cfg.security.autoQuarantineEnabled && accountAgeMs < threeDaysMs && cfg.quarantineRoleId && cfg.quarantineChannelId) {
        await applyQuarantine(cfg, member, "auto");
        await sendLog(
            guild,
            "Auto-Quarantine",
            `New account ${member.user.tag} placed in quarantine (account under 3 days).`,
            member.user,
            "medium"
        );
    }

    if (!cfg.welcome.enabled) return;

    const channel = cfg.welcome.channelId
        ? guild.channels.cache.get(cfg.welcome.channelId)
        : guild.systemChannel;

    if (!channel || channel.type !== ChannelType.GuildText) return;

    let lines = [];

    if (cfg.welcome.customText) {
        lines = cfg.welcome.customText.split("\n");
    } else {
        if (cfg.welcome.style === "short") {
            lines = [
                `Welcome ${member} to ${guild.name}.`,
                "Read the rules and enjoy your stay.",
                `Info: ${WEBSITE_URL}`
            ];
        } else if (cfg.welcome.style === "detailed") {
            lines = [
                `Welcome ${member} to ${guild.name}.`,
                "",
                "This server uses CyberShield for:",
                "- Raid detection and automatic freeze.",
                "- Channel delete protection.",
                "- Webhook and invite blocking.",
                "- Quarantine for suspicious accounts.",
                "",
                `Recommended: verify, read rules, and keep notifications on for staff announcements.`,
                `More info: ${WEBSITE_URL}`
            ];
        } else {
            lines = [
                `Welcome ${member} to ${guild.name}.`,
                "",
                "CyberShield is active here (anti-raid, anti-nuke, anti-spam, quarantine).",
                `Info and settings: ${WEBSITE_URL}`
            ];
        }
    }

    lines = lines.slice(0, cfg.welcome.maxLines);

    const embed = new EmbedBuilder()
        .setTitle(`Welcome to ${guild.name}`)
        .setDescription(lines.join("\n"))
        .setColor(0x57f287)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setTimestamp();

    const msg = await channel.send({ embeds: [embed] }).catch(() => null);
    if (msg) {
        setTimeout(() => {
            msg.delete().catch(() => null);
        }, 4 * 60 * 1000);
    }
});

// -----------------------
// 10. Automated Security Systems
// -----------------------

// 10.1 Webhook Guard & Invite Shield (message-level)
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    const isStaff = cfg.staffRoleId && msg.member?.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    if (isStaff || isOwner || isWhitelisted) return;

    const content = msg.content.toLowerCase();
    const hasWebhook = cfg.security.antiWebhookEnabled && content.includes("discord.com/api/webhooks");
    const hasInvite = cfg.security.antiInviteEnabled && (content.includes("discord.gg/") || content.includes("discord.com/invite/"));

    if (hasWebhook || hasInvite) {
        await msg.delete().catch(() => null);
        await sendLog(
            msg.guild,
            "Security Block",
            `Deleted message from ${msg.author.tag} in #${msg.channel.name}\nReason: ${hasWebhook ? "Webhook link" : "Invite link"}`,
            msg.author,
            "medium"
        );
        await sendPublicAlert(
            msg.channel,
            msg.guild,
            hasWebhook
                ? "Webhook Guard: A webhook link was blocked in this channel."
                : "Invite Shield: An invite link was blocked in this channel."
        );
    }
});

// 10.2 Anti-Attachment (new accounts or quarantined)
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    if (!cfg.security.antiAttachmentEnabled) return;

    const member = msg.member;
    if (!member) return;

    const isStaff = cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    if (isStaff || isOwner || isWhitelisted) return;

    const hasAttachment = msg.attachments.size > 0;
    if (!hasAttachment) return;

    const accountAgeMs = Date.now() - msg.author.createdTimestamp;
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const isQuarantined = cfg.quarantineRoleId && member.roles.cache.has(cfg.quarantineRoleId);

    if (accountAgeMs < threeDaysMs || isQuarantined) {
        await msg.delete().catch(() => null);
        await sendLog(
            msg.guild,
            "Anti-Attachment",
            `Deleted attachment from ${msg.author.tag} in #${msg.channel.name} (new or quarantined account).`,
            msg.author,
            "medium"
        );
        await sendPublicAlert(
            msg.channel,
            msg.guild,
            "Anti-Attachment: A suspicious attachment was blocked in this channel."
        );
    }
});

// 10.3 Anti-Spam (configurable)
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    if (!cfg.security.antiSpamEnabled) return;

    const isStaff = cfg.staffRoleId && msg.member?.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    if (isStaff || isOwner || isWhitelisted) return;

    const key = `${msg.guild.id}-${msg.author.id}`;
    const now = Date.now();

    if (!spamTracker.has(key)) spamTracker.set(key, []);
    const timestamps = spamTracker.get(key);
    timestamps.push(now);

    const filtered = timestamps.filter(t => now - t < cfg.security.spamWindowMs);
    spamTracker.set(key, filtered);

    if (filtered.length >= cfg.security.spamMessages) {
        if (msg.member.moderatable) {
            await msg.member.timeout(10 * 60 * 1000, "Auto Anti-Spam").catch(() => null);
            await sendLog(
                msg.guild,
                "Anti-Spam Triggered",
                `${msg.author.tag} was timed out for spamming.`,
                msg.author,
                "medium"
            );
            await sendPublicAlert(
                msg.channel,
                msg.guild,
                "Anti-Spam: A spam burst was detected and the user was timed out."
            );
        }
        spamTracker.delete(key);
    }
});

// 10.4 Anti-Mass-Mention
client.on("messageCreate", async (msg) => {
    if (!msg.guild || msg.author.bot) return;

    const cfg = getGuildConfig(msg.guild);
    if (!cfg.security.antiMassMentionEnabled) return;

    const member = msg.member;
    if (!member) return;

    const isStaff = cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId);
    const isOwner = msg.author.id === msg.guild.ownerId;
    const isWhitelisted = WHITELIST.includes(msg.author.id);

    if (isStaff || isOwner || isWhitelisted) return;

    const mentionsEveryone = msg.mentions.everyone;
    const userMentions = msg.mentions.users.size;

    if (mentionsEveryone || userMentions >= 5) {
        await msg.delete().catch(() => null);
        if (member.moderatable) {
            await member.timeout(10 * 60 * 1000, "Anti-Mass-Mention").catch(() => null);
        }
        await sendLog(
            msg.guild,
            "Anti-Mass-Mention",
            `Message from ${msg.author.tag} deleted and user timed out for mass mention.`,
            msg.author,
            "high"
        );
        await sendPublicAlert(
            msg.channel,
            msg.guild,
            "Anti-Mass-Mention: A mass mention attempt was blocked and the user was timed out."
        );
    }
});

// 10.5 Beast Mode (Raid Defense)
client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiRaidEnabled) return;

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
            "Detected raid (8+ joins/10s). Server automatically frozen.",
            null,
            "high"
        );
        const systemChannel = guild.systemChannel;
        if (systemChannel) {
            await sendPublicAlert(
                systemChannel,
                guild,
                "Anti-Raid: A raid attempt was detected and the server was automatically frozen."
            );
        }
    }
});

// 10.6 Anti-Nuke
client.on("channelDelete", async (channel) => {
    if (!channel.guild) return;
    const guild = channel.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiNukeEnabled) return;

    try {
        const logs = await guild.fetchAuditLogs({ type: 12, limit: 1 });
        const entry = logs.entries.first();
        if (!entry) return;

        const executor = entry.executor;
        const isOwner = executor.id === guild.ownerId;
        const isWhitelisted = WHITELIST.includes(executor.id);
        const member = guild.members.cache.get(executor.id);
        const isStaff = cfg.staffRoleId && member?.roles.cache.has(cfg.staffRoleId);

        if (isOwner || isWhitelisted || isStaff) return;

        const newChannel = await guild.channels.create({
            name: channel.name,
            type: channel.type,
            topic: channel.topic ?? null,
            parent: channel.parentId ?? null,
            position: channel.rawPosition
        }).catch(() => null);

        if (member && member.manageable) {
            const rolesToRemove = member.roles.cache.filter(r =>
                r.id !== guild.id &&
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
            `Channel ${channel.name} was deleted by ${executor.tag} and has been recreated. Dangerous permissions were removed from the executor.`,
            executor,
            "high"
        );

        if (newChannel && channel.isTextBased()) {
            await sendPublicAlert(
                newChannel,
                guild,
                "Anti-Nuke: A channel deletion attack was blocked and the channel was recreated."
            );
        }
    } catch (err) {
        console.error("Anti-Nuke error:", err);
    }
});

// 10.7 Anti-Channel-Spam
client.on("channelCreate", async (channel) => {
    if (!channel.guild) return;
    const guild = channel.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiChannelSpamEnabled) return;

    const now = Date.now();
    const key = guild.id;

    if (!channelCreateTracker.has(key)) channelCreateTracker.set(key, []);
    const timestamps = channelCreateTracker.get(key);
    timestamps.push(now);

    const filtered = timestamps.filter(t => now - t < 10000);
    channelCreateTracker.set(key, filtered);

    if (filtered.length >= 10) {
        await sendLog(
            guild,
            "Anti-Channel-Spam",
            "High rate of channel creation detected.",
            null,
            "high"
        );
        if (channel.isTextBased()) {
            await sendPublicAlert(
                channel,
                guild,
                "Anti-Channel-Spam: Unusual channel creation activity was detected."
            );
        }
    }
});

// 10.8 Anti-Role-Spam
client.on("roleCreate", async (role) => {
    const guild = role.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiRoleSpamEnabled) return;

    const now = Date.now();
    const key = guild.id;

    if (!roleCreateTracker.has(key)) roleCreateTracker.set(key, []);
    const timestamps = roleCreateTracker.get(key);
    timestamps.push(now);

    const filtered = timestamps.filter(t => now - t < 10000);
    roleCreateTracker.set(key, filtered);

    if (filtered.length >= 10) {
        await sendLog(
            guild,
            "Anti-Role-Spam",
            "High rate of role creation detected.",
            null,
            "high"
        );
    }
});

// 10.9 Anti-Emoji-Spam
client.on("emojiCreate", async (emoji) => {
    const guild = emoji.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiEmojiSpamEnabled) return;

    const now = Date.now();
    const key = guild.id;

    if (!emojiCreateTracker.has(key)) emojiCreateTracker.set(key, []);
    const timestamps = emojiCreateTracker.get(key);
    timestamps.push(now);

    const filtered = timestamps.filter(t => now - t < 10000);
    emojiCreateTracker.set(key, filtered);

    if (filtered.length >= 10) {
        await sendLog(
            guild,
            "Anti-Emoji-Spam",
            "High rate of emoji creation detected.",
            null,
            "high"
        );
    }
});

// 10.10 Anti-Webhook-Spam (creation-level)
client.on("webhookUpdate", async (channel) => {
    if (!channel.guild) return;
    const guild = channel.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiWebhookSpamEnabled) return;

    try {
        const logs = await guild.fetchAuditLogs({ type: 50, limit: 1 });
        const entry = logs.entries.first();
        if (!entry) return;

        const executor = entry.executor;
        const isOwner = executor.id === guild.ownerId;
        const isWhitelisted = WHITELIST.includes(executor.id);
        const member = guild.members.cache.get(executor.id);
        const isStaff = cfg.staffRoleId && member?.roles.cache.has(cfg.staffRoleId);

        const now = Date.now();
        const key = guild.id;
        if (!webhookCreateTracker.has(key)) webhookCreateTracker.set(key, []);
        const timestamps = webhookCreateTracker.get(key);
        timestamps.push(now);
        const filtered = timestamps.filter(t => now - t < 10000);
        webhookCreateTracker.set(key, filtered);

        const webhook = entry.target;
        if (!isOwner && !isWhitelisted && !isStaff) {
            if (webhook && webhook.delete) {
                await webhook.delete("Unauthorized webhook creation blocked by CyberShield").catch(() => null);
            }
            await sendLog(
                guild,
                "Webhook Guard",
                `Unauthorized webhook created by ${executor.tag} in #${channel.name} was deleted.`,
                executor,
                "high"
            );
            if (channel.isTextBased()) {
                await sendPublicAlert(
                    channel,
                    guild,
                    "Webhook Guard: An unauthorized webhook was removed from this channel."
                );
            }
        }

        if (filtered.length >= 5) {
            await sendLog(
                guild,
                "Anti-Webhook-Spam",
                "High rate of webhook creation detected.",
                executor,
                "high"
            );
        }
    } catch (err) {
        console.error("Webhook Guard error:", err);
    }
});

// 10.11 Anti-Thread-Spam
client.on("threadCreate", async (thread) => {
    if (!thread.guild) return;
    const guild = thread.guild;
    const cfg = getGuildConfig(guild);
    if (!cfg.security.antiThreadSpamEnabled) return;

    const now = Date.now();
    const key = guild.id;

    if (!threadCreateTracker.has(key)) threadCreateTracker.set(key, []);
    const timestamps = threadCreateTracker.get(key);
    timestamps.push(now);

    const filtered = timestamps.filter(t => now - t < 10000);
    threadCreateTracker.set(key, filtered);

    if (filtered.length >= 10) {
        await sendLog(
            guild,
            "Anti-Thread-Spam",
            "High rate of thread creation detected.",
            null,
            "high"
        );
    }
});

// 10.12 Anti-Ghost-Ping
client.on("messageDelete", async (msg) => {
    if (!msg.guild || !msg.mentions) return;

    const cfg = getGuildConfig(msg.guild);
    if (!cfg.security.antiGhostPingEnabled) return;

    const mentionedUsers = msg.mentions.users;
    if (!mentionedUsers || mentionedUsers.size === 0) return;

    await sendLog(
        msg.guild,
        "Anti-Ghost-Ping",
        `A message by ${msg.author?.tag || "Unknown"} was deleted after pinging: ${mentionedUsers.map(u => u.tag).join(", ")}`,
        msg.author || null,
        "medium"
    );

    if (msg.channel && msg.channel.isTextBased()) {
        await sendPublicAlert(
            msg.channel,
            msg.guild,
            "Anti-Ghost-Ping: A deleted message that pinged users was detected."
        );
    }
});

// -----------------------
// 11. Login
// -----------------------
client.login(process.env.TOKEN).catch(err => {
    console.error("Failed to login:", err);
});
