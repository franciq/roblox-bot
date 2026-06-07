// ============================================================
// Discord Bot — Roblox Lookup (FIXED VERSION)
// ============================================================

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// FIX REST + ROUTES (NAJWAŻNIEJSZE)
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

// fetch fallback (Node 18+ OK)
const fetchFn = global.fetch || ((...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args))
);

// ── CONFIG ─────────────────────────────
const TOKEN     = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

const CACHE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS  = 8 * 1000;

// ── CACHE ─────────────────────────────
const cache = new Map();
const cooldown = new Map();

function cacheGet(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) return null;
  return e.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function checkCooldown(id) {
  const last = cooldown.get(id);
  if (!last) return 0;
  const diff = COOLDOWN_MS - (Date.now() - last);
  return diff > 0 ? diff : 0;
}

function setCooldown(id) {
  cooldown.set(id, Date.now());
}

// ── ROBLOX API ─────────────────────────
async function robloxFetch(url, options) {
  try {
    const res = await fetchFn(url, options);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getUserId(username) {
  const key = `uid:${username}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await robloxFetch(
    "https://users.roblox.com/v1/usernames/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [username],
        excludeBannedUsers: false
      })
    }
  );

  const id = data?.data?.[0]?.id;
  if (!id) return null;

  cacheSet(key, id);
  return id;
}

async function getUserInfo(id) {
  const key = `info:${id}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await robloxFetch(`https://users.roblox.com/v1/users/${id}`);
  if (data) cacheSet(key, data);
  return data;
}

async function getAvatar(id) {
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${id}&size=420x420&format=Png`
  );
  return data?.data?.[0]?.imageUrl ?? null;
}

// ── COMMANDS ─────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Profil Roblox")
    .addStringOption(o =>
      o.setName("user").setDescription("nick lub id").setRequired(true)
    )
    .toJSON()
];

// register commands
const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("Rejestracja komend...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("OK komendy zarejestrowane");
  } catch (e) {
    console.error("Błąd komend:", e);
  }
})();

// ── BOT ───────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const cd = checkCooldown(i.user.id);
  if (cd > 0) {
    return i.reply({
      content: `⏳ Poczekaj ${(cd / 1000).toFixed(1)}s`,
      ephemeral: true
    });
  }

  setCooldown(i.user.id);
  await i.deferReply();

  try {
    if (i.commandName === "roblox") {
      const input = i.options.getString("user");

      const userId = /^\d+$/.test(input)
        ? Number(input)
        : await getUserId(input);

      if (!userId) return i.editReply("Nie znaleziono użytkownika");

      const info = await getUserInfo(userId);
      const avatar = await getAvatar(userId);

      const embed = new EmbedBuilder()
        .setTitle(`${info.displayName} (@${info.name})`)
        .setURL(`https://www.roblox.com/users/${userId}/profile`)
        .setThumbnail(avatar)
        .addFields(
          { name: "ID", value: String(userId), inline: true },
          { name: "Nick", value: info.name, inline: true }
        );

      return i.editReply({ embeds: [embed] });
    }
  } catch (e) {
    console.error(e);
    i.editReply("Błąd botu");
  }
});

client.login(TOKEN);