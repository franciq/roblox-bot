// ============================================================
//  Discord Bot — Roblox Lookup
//  Wymagania: node >= 18, discord.js ^14, @discordjs/rest ^2
//  npm install discord.js @discordjs/rest
// ============================================================

const {
  Client, GatewayIntentBits, EmbedBuilder,
  SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");
const { REST, Routes } = require("@discordjs/rest");

// ── KONFIGURACJA ─────────────────────────────────────────────
const TOKEN     = process.env.TOKEN     || "TWÓJ_TOKEN_BOTA";
const CLIENT_ID = process.env.CLIENT_ID || "TWOJE_CLIENT_ID";
const GUILD_ID  = process.env.GUILD_ID  || "TWOJE_GUILD_ID";

const CACHE_TTL_MS  = 5 * 60 * 1000;  // cache 5 minut
const COOLDOWN_MS   = 8 * 1000;        // cooldown 8 sekund na usera
// ─────────────────────────────────────────────────────────────

// ── CACHE & COOLDOWN ──────────────────────────────────────────
const cache    = new Map(); // klucz → { data, ts }
const cooldown = new Map(); // userId Discord → timestamp

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
function cacheSet(key, data) { cache.set(key, { data, ts: Date.now() }); }

function checkCooldown(discordUserId) {
  const last = cooldown.get(discordUserId);
  if (!last) return 0;
  const remaining = COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}
function setCooldown(discordUserId) { cooldown.set(discordUserId, Date.now()); }
// ─────────────────────────────────────────────────────────────

// ── ROBLOX API HELPERS ────────────────────────────────────────
async function robloxFetch(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

async function getUserId(username) {
  const cacheKey = `uid:${username.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  const data = await res.json();
  if (!data.data || data.data.length === 0) return null;
  const id = data.data[0].id;
  cacheSet(cacheKey, id);
  return id;
}

async function getUserInfo(userId) {
  const cacheKey = `info:${userId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const data = await robloxFetch(`https://users.roblox.com/v1/users/${userId}`);
  if (data) cacheSet(cacheKey, data);
  return data;
}

async function getAvatarFull(userId) {
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`
  );
  return data?.data?.[0]?.imageUrl ?? null;
}

async function getAvatarBust(userId) {
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/users/avatar-bust?userIds=${userId}&size=150x150&format=Png&isCircular=false`
  );
  return data?.data?.[0]?.imageUrl ?? null;
}

async function getFriendCount(userId) {
  const data = await robloxFetch(`https://friends.roblox.com/v1/users/${userId}/friends/count`);
  return data?.count ?? "?";
}

async function getFollowerCount(userId) {
  const data = await robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followers/count`);
  return data?.count ?? "?";
}

async function getFollowingCount(userId) {
  const data = await robloxFetch(`https://friends.roblox.com/v1/users/${userId}/followings/count`);
  return data?.count ?? "?";
}

async function hasPremium(userId) {
  try {
    const res = await fetch(`https://premiumfeatures.roblox.com/v1/users/${userId}/validate-membership`);
    if (!res.ok) return false;
    return (await res.text()).trim() === "true";
  } catch { return false; }
}

async function isBanned(userId) {
  const data = await robloxFetch(`https://users.roblox.com/v1/users/${userId}`);
  return data?.isBanned ?? false;
}

// Ostatnio grane gry (przez historię obecności)
async function getRecentGames(userId) {
  const data = await robloxFetch(
    `https://games.roblox.com/v2/users/${userId}/games?accessFilter=2&limit=6&sortOrder=Asc`
  );
  return data?.data ?? [];
}

// Info o konkretnej grze po universeId lub nazwie
async function searchGame(query) {
  const data = await robloxFetch(
    `https://games.roblox.com/v1/games/list?model.keyword=${encodeURIComponent(query)}&model.startRows=0&model.maxRows=6`
  );
  return data?.games ?? [];
}

async function getGameInfo(universeId) {
  const data = await robloxFetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`);
  return data?.data?.[0] ?? null;
}

async function getGameIcon(universeId) {
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`
  );
  return data?.data?.[0]?.imageUrl ?? null;
}

async function getGameThumbnail(universeId) {
  const data = await robloxFetch(
    `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${universeId}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`
  );
  return data?.data?.[0]?.thumbnails?.[0]?.imageUrl ?? null;
}

// RAP (Recent Average Price) przez inventory
async function getRAP(userId) {
  try {
    let rap = 0;
    let cursor = "";
    let pages = 0;
    do {
      const url = `https://inventory.roblox.com/v1/users/${userId}/assets/collectibles?sortOrder=Asc&limit=100${cursor ? `&cursor=${cursor}` : ""}`;
      const data = await robloxFetch(url);
      if (!data || !data.data) break;
      for (const item of data.data) rap += item.recentAveragePrice ?? 0;
      cursor = data.nextPageCursor ?? "";
      pages++;
    } while (cursor && pages < 5); // max 5 stron = 500 itemów
    return rap;
  } catch { return null; }
}

function formatNumber(n) {
  if (n === "?" || n == null) return "?";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function accountAge(created) {
  if (!created) return "?";
  const ms = Date.now() - new Date(created).getTime();
  const days = Math.floor(ms / 86400000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years > 0) return `${years}l ${months}mies.`;
  if (months > 0) return `${months} mies.`;
  return `${days} dni`;
}
// ─────────────────────────────────────────────────────────────

// ── KOMENDY ───────────────────────────────────────────────────
const commands = [
  // /roblox <nazwa|id>
  new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Wyświetla profil użytkownika Roblox")
    .addStringOption(o => o.setName("nazwa").setDescription("Nazwa lub ID użytkownika").setRequired(true))
    .toJSON(),

  // /roblox-avatar <nazwa|id>
  new SlashCommandBuilder()
    .setName("roblox-avatar")
    .setDescription("Pełny avatar (full body) użytkownika Roblox")
    .addStringOption(o => o.setName("nazwa").setDescription("Nazwa lub ID użytkownika").setRequired(true))
    .toJSON(),

  // /roblox-gry <nazwa|id>
  new SlashCommandBuilder()
    .setName("roblox-gry")
    .setDescription("Lista gier stworzonych przez użytkownika Roblox")
    .addStringOption(o => o.setName("nazwa").setDescription("Nazwa lub ID użytkownika").setRequired(true))
    .toJSON(),

  // /roblox-gra <nazwa gry>
  new SlashCommandBuilder()
    .setName("roblox-gra")
    .setDescription("Informacje o grze na Roblox")
    .addStringOption(o => o.setName("nazwa").setDescription("Nazwa gry").setRequired(true))
    .toJSON(),

  // /roblox-vs <nazwa1> <nazwa2>
  new SlashCommandBuilder()
    .setName("roblox-vs")
    .setDescription("Porównuje dwóch użytkowników Roblox")
    .addStringOption(o => o.setName("gracz1").setDescription("Pierwszy gracz").setRequired(true))
    .addStringOption(o => o.setName("gracz2").setDescription("Drugi gracz").setRequired(true))
    .toJSON(),

  // /roblox-id <id>
  new SlashCommandBuilder()
    .setName("roblox-id")
    .setDescription("Wyszukuje użytkownika Roblox po ID")
    .addIntegerOption(o => o.setName("id").setDescription("User ID").setRequired(true))
    .toJSON(),
];

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    console.log("Rejestruję komendy slash...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Komendy zarejestrowane!");
  } catch (err) {
    console.error("❌ Błąd rejestracji komend:", err);
  }
})();
// ─────────────────────────────────────────────────────────────

// ── BUDOWANIE EMBEDA PROFILU ──────────────────────────────────
async function buildProfileEmbed(userId) {
  const [info, avatarUrl, friends, followers, following, premium, rap] = await Promise.all([
    getUserInfo(userId),
    getAvatarBust(userId),
    getFriendCount(userId),
    getFollowerCount(userId),
    getFollowingCount(userId),
    hasPremium(userId),
    getRAP(userId),
  ]);

  if (!info) return null;

  const banned = info.isBanned ?? false;
  const joinedTs = info.created
    ? Math.floor(new Date(info.created).getTime() / 1000)
    : null;

  const embed = new EmbedBuilder()
    .setColor(banned ? 0xff4444 : premium ? 0xffcc00 : 0x00b4ff)
    .setAuthor({
      name: banned ? "🚫 Konto zbanowane" : premium ? "⭐ Roblox Premium" : "Roblox",
      iconURL: "https://images.rbxcdn.com/e37d19eb3a05caeb0bf7e9f68d5b0a52.ico",
    })
    .setTitle(`${info.displayName} (@${info.name})`)
    .setURL(`https://www.roblox.com/users/${userId}/profile`)
    .setThumbnail(avatarUrl)
    .addFields(
      { name: "🆔 User ID",       value: `${userId}`,                          inline: true },
      { name: "📛 Display Name",  value: info.displayName,                     inline: true },
      { name: "👤 Username",      value: `@${info.name}`,                      inline: true },
      { name: "👥 Znajomi",       value: formatNumber(friends),                inline: true },
      { name: "📣 Obserwujący",   value: formatNumber(followers),              inline: true },
      { name: "👁️ Obserwuje",     value: formatNumber(following),              inline: true },
      { name: "⭐ Premium",       value: premium ? "Tak" : "Nie",              inline: true },
      { name: "🚫 Zbanowany",     value: banned  ? "Tak" : "Nie",              inline: true },
      { name: "⏳ Wiek konta",    value: accountAge(info.created),            inline: true },
      { name: "📅 Na Roblox od",  value: joinedTs ? `<t:${joinedTs}:D>` : "?", inline: true },
      { name: "💰 RAP (inventory)", value: rap != null ? `${formatNumber(rap)} R$` : "Prywatne", inline: true },
    );

  if (info.description?.trim()) {
    embed.setDescription(`*${info.description.slice(0, 250)}${info.description.length > 250 ? "…" : ""}*`);
  }

  embed.setFooter({ text: "Roblox Profile Lookup • /roblox-avatar dla full body" });
  return embed;
}
// ─────────────────────────────────────────────────────────────

// ── BOT ───────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => console.log(`✅ Bot zalogowany jako ${client.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Cooldown check
  const cd = checkCooldown(interaction.user.id);
  if (cd > 0) {
    return interaction.reply({
      content: `⏳ Poczekaj jeszcze **${(cd / 1000).toFixed(1)}s** przed kolejną komendą.`,
      ephemeral: true,
    });
  }
  setCooldown(interaction.user.id);

  await interaction.deferReply();
  const cmd = interaction.commandName;

  try {

    // ── /roblox ──────────────────────────────────────────────
    if (cmd === "roblox" || cmd === "roblox-id") {
      let userId;
      if (cmd === "roblox-id") {
        userId = interaction.options.getInteger("id");
      } else {
        const input = interaction.options.getString("nazwa").trim();
        userId = /^\d+$/.test(input) ? parseInt(input) : await getUserId(input);
      }
      if (!userId) return interaction.editReply("❌ Nie znaleziono użytkownika.");

      const embed = await buildProfileEmbed(userId);
      if (!embed) return interaction.editReply("❌ Nie udało się pobrać danych.");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Profil Roblox")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/users/${userId}/profile`)
          .setEmoji("🔗"),
        new ButtonBuilder()
          .setLabel("Pełny Avatar")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/users/${userId}/profile`)
          .setEmoji("👗"),
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // ── /roblox-avatar ───────────────────────────────────────
    if (cmd === "roblox-avatar") {
      const input = interaction.options.getString("nazwa").trim();
      const userId = /^\d+$/.test(input) ? parseInt(input) : await getUserId(input);
      if (!userId) return interaction.editReply("❌ Nie znaleziono użytkownika.");

      const [info, avatarUrl, premium] = await Promise.all([
        getUserInfo(userId),
        getAvatarFull(userId),
        hasPremium(userId),
      ]);
      if (!info) return interaction.editReply("❌ Nie udało się pobrać danych.");

      const embed = new EmbedBuilder()
        .setColor(premium ? 0xffcc00 : 0x00b4ff)
        .setTitle(`👗 Avatar — ${info.displayName} (@${info.name})`)
        .setURL(`https://www.roblox.com/users/${userId}/profile`)
        .setImage(avatarUrl)
        .setFooter({ text: `User ID: ${userId}` });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /roblox-gry ──────────────────────────────────────────
    if (cmd === "roblox-gry") {
      const input = interaction.options.getString("nazwa").trim();
      const userId = /^\d+$/.test(input) ? parseInt(input) : await getUserId(input);
      if (!userId) return interaction.editReply("❌ Nie znaleziono użytkownika.");

      const [info, games] = await Promise.all([
        getUserInfo(userId),
        getRecentGames(userId),
      ]);
      if (!info) return interaction.editReply("❌ Nie udało się pobrać danych.");

      const embed = new EmbedBuilder()
        .setColor(0x00b4ff)
        .setTitle(`🎮 Gry — ${info.displayName} (@${info.name})`)
        .setURL(`https://www.roblox.com/users/${userId}/profile`)
        .setFooter({ text: `User ID: ${userId}` });

      if (!games || games.length === 0) {
        embed.setDescription("Brak publicznych gier lub profil jest prywatny.");
      } else {
        const lines = games.map((g, i) => {
          const visits = g.placeVisits != null ? `${formatNumber(g.placeVisits)} wizyt` : "";
          return `**${i + 1}. [${g.name}](https://www.roblox.com/games/${g.rootPlace?.id ?? g.id})**${visits ? ` • ${visits}` : ""}`;
        });
        embed.setDescription(lines.join("\n"));
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /roblox-gra ──────────────────────────────────────────
    if (cmd === "roblox-gra") {
      const query = interaction.options.getString("nazwa").trim();
      const results = await searchGame(query);
      if (!results || results.length === 0) {
        return interaction.editReply(`❌ Nie znaleziono gry **${query}**.`);
      }

      const game = results[0];
      const universeId = game.universeId;

      const [fullInfo, iconUrl, thumbUrl] = await Promise.all([
        getGameInfo(universeId),
        getGameIcon(universeId),
        getGameThumbnail(universeId),
      ]);

      const g = fullInfo ?? game;
      const rating = (g.totalUpVotes != null && g.totalDownVotes != null)
        ? `👍 ${formatNumber(g.totalUpVotes)}  👎 ${formatNumber(g.totalDownVotes)}`
        : "?";

      const embed = new EmbedBuilder()
        .setColor(0x02b757)
        .setAuthor({ name: "Roblox Game Info", iconURL: "https://images.rbxcdn.com/e37d19eb3a05caeb0bf7e9f68d5b0a52.ico" })
        .setTitle(g.name ?? query)
        .setURL(`https://www.roblox.com/games/${g.rootPlaceId ?? game.placeId}`)
        .setThumbnail(iconUrl)
        .setImage(thumbUrl)
        .addFields(
          { name: "🌐 Aktywni",      value: formatNumber(g.playing),       inline: true },
          { name: "👁️ Wizyty",       value: formatNumber(g.visits),        inline: true },
          { name: "⭐ Ulubione",     value: formatNumber(g.favoritedCount), inline: true },
          { name: "📊 Oceny",        value: rating,                        inline: false },
          { name: "🔒 Dostęp",       value: g.isAllGenre ? "Wszystkie" : (g.genre ?? "?"), inline: true },
          { name: "🔞 Max. graczy",  value: g.maxPlayers != null ? `${g.maxPlayers}` : "?", inline: true },
        );

      if (g.description?.trim()) {
        embed.setDescription(g.description.slice(0, 300) + (g.description.length > 300 ? "…" : ""));
      }

      embed.setFooter({ text: `Universe ID: ${universeId}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Otwórz grę")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://www.roblox.com/games/${g.rootPlaceId ?? game.placeId}`)
          .setEmoji("🎮"),
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // ── /roblox-vs ───────────────────────────────────────────
    if (cmd === "roblox-vs") {
      const input1 = interaction.options.getString("gracz1").trim();
      const input2 = interaction.options.getString("gracz2").trim();

      const [id1, id2] = await Promise.all([
        /^\d+$/.test(input1) ? parseInt(input1) : getUserId(input1),
        /^\d+$/.test(input2) ? parseInt(input2) : getUserId(input2),
      ]);

      if (!id1) return interaction.editReply(`❌ Nie znaleziono gracza **${input1}**.`);
      if (!id2) return interaction.editReply(`❌ Nie znaleziono gracza **${input2}**.`);

      const [[info1, followers1, friends1, premium1, rap1], [info2, followers2, friends2, premium2, rap2]] =
        await Promise.all([
          Promise.all([getUserInfo(id1), getFollowerCount(id1), getFriendCount(id1), hasPremium(id1), getRAP(id1)]),
          Promise.all([getUserInfo(id2), getFollowerCount(id2), getFriendCount(id2), hasPremium(id2), getRAP(id2)]),
        ]);

      if (!info1 || !info2) return interaction.editReply("❌ Nie udało się pobrać danych jednego z graczy.");

      function winner(a, b) {
        if (a === "?" || b === "?" || a == null || b == null) return "➖";
        return a > b ? "⬅️" : a < b ? "➡️" : "🤝";
      }

      const age1 = info1.created ? Date.now() - new Date(info1.created).getTime() : 0;
      const age2 = info2.created ? Date.now() - new Date(info2.created).getTime() : 0;

      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`⚔️ ${info1.name} vs ${info2.name}`)
        .setDescription("Porównanie profili Roblox")
        .addFields(
          { name: "\u200b", value: `**[${info1.displayName}](https://www.roblox.com/users/${id1}/profile)**\n@${info1.name}`, inline: true },
          { name: "\u200b", value: "**vs**", inline: true },
          { name: "\u200b", value: `**[${info2.displayName}](https://www.roblox.com/users/${id2}/profile)**\n@${info2.name}`, inline: true },

          { name: "📣 Obserwujący", value: `${formatNumber(followers1)}`, inline: true },
          { name: winner(followers1, followers2), value: "Obserwujący", inline: true },
          { name: `${formatNumber(followers2)}`, value: "\u200b", inline: true },

          { name: "👥 Znajomi", value: `${formatNumber(friends1)}`, inline: true },
          { name: winner(friends1, friends2), value: "Znajomi", inline: true },
          { name: `${formatNumber(friends2)}`, value: "\u200b", inline: true },

          { name: "⏳ Wiek konta", value: accountAge(info1.created), inline: true },
          { name: winner(age1, age2), value: "Starsze konto", inline: true },
          { name: accountAge(info2.created), value: "\u200b", inline: true },

          { name: "⭐ Premium", value: premium1 ? "Tak" : "Nie", inline: true },
          { name: "\u200b", value: "Premium", inline: true },
          { name: premium2 ? "Tak" : "Nie", value: "\u200b", inline: true },

          { name: "💰 RAP", value: rap1 != null ? `${formatNumber(rap1)} R$` : "Prywatne", inline: true },
          { name: winner(rap1 ?? -1, rap2 ?? -1), value: "RAP", inline: true },
          { name: rap2 != null ? `${formatNumber(rap2)} R$` : "Prywatne", value: "\u200b", inline: true },
        )
        .setFooter({ text: "⬅️ = lewa strona wygrywa | ➡️ = prawa | 🤝 = remis" });

      return interaction.editReply({ embeds: [embed] });
    }

  } catch (err) {
    console.error(err);
    interaction.editReply("❌ Wystąpił błąd podczas pobierania danych.").catch(() => {});
  }
});

client.login(TOKEN);
