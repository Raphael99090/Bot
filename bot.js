const {
  Client, GatewayIntentBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ComponentType, REST, Routes,
  SlashCommandBuilder, AttachmentBuilder,
} = require("discord.js");
const { Pool } = require("pg");
const puppeteer = require("puppeteer");

// ─── PUPPETEER (browser persistente, reaproveitado entre comandos) ───
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  return _browser;
}

async function renderHTML(html, width, height) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  const buffer = await page.screenshot({ type: "png" });
  await page.close();
  return buffer;
}
// ──────────────────────────────────────────────────────────

// ─── CONFIG ───────────────────────────────────────────────
const TOKEN        = process.env.TOKEN        || "SEU_TOKEN_AQUI";
const CLIENT_ID    = process.env.CLIENT_ID    || "SEU_CLIENT_ID_AQUI";
const OWNER_ID     = process.env.OWNER_ID     || "SEU_ID_AQUI";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "SUA_GROQ_API_KEY_AQUI";
const DATABASE_URL = process.env.DATABASE_URL || null;
// ──────────────────────────────────────────────────────────

// ─── LOGGER ───────────────────────────────────────────────
function log(tipo, msg) {
  const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const p  = { info: "ℹ️", ok: "✅", warn: "⚠️", error: "❌" };
  console.log(`[${ts}] ${p[tipo] || "•"} ${msg}`);
}
// ──────────────────────────────────────────────────────────

// ─── POSTGRES ─────────────────────────────────────────────
const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

async function query(sql, params = []) {
  if (!pool) throw new Error("PostgreSQL não configurado.");
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      username TEXT,
      pontos INTEGER DEFAULT 0,
      ultimo_diario BIGINT DEFAULT 0,
      ultimo_crime BIGINT DEFAULT 0,
      ultima_missao BIGINT DEFAULT 0,
      duelos_ganhos INTEGER DEFAULT 0,
      duelos_perdidos INTEGER DEFAULT 0,
      trivia_acertos INTEGER DEFAULT 0,
      slots_jogados INTEGER DEFAULT 0,
      bj_jogados INTEGER DEFAULT 0,
      nivel INTEGER DEFAULT 0
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS loja (
      id SERIAL PRIMARY KEY,
      nome TEXT UNIQUE,
      preco INTEGER,
      descricao TEXT,
      cargo_id TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS inventario (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      item_nome TEXT,
      comprado_em BIGINT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS missoes (
      user_id TEXT PRIMARY KEY,
      descricao TEXT,
      recompensa INTEGER,
      concluida BOOLEAN DEFAULT false,
      criada_em BIGINT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS ia_historico (
      user_id TEXT PRIMARY KEY,
      historico JSONB DEFAULT '[]'
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      tipo TEXT,
      descricao TEXT,
      criado_em BIGINT DEFAULT extract(epoch from now())
    )
  `);
  log("ok", "Banco de dados inicializado.");
}

// ── Helpers de usuário ────────────────────────────────────
async function getUser(id, username = "") {
  await query(
    `INSERT INTO usuarios (id, username) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username`,
    [id, username]
  );
  const r = await query(`SELECT * FROM usuarios WHERE id = $1`, [id]);
  return r.rows[0];
}

async function addPontos(id, username, qtd) {
  await getUser(id, username);
  const r = await query(
    `UPDATE usuarios SET pontos = pontos + $1 WHERE id = $2 RETURNING pontos`,
    [qtd, id]
  );
  return r.rows[0].pontos;
}

async function getPontos(id) {
  const r = await query(`SELECT pontos FROM usuarios WHERE id = $1`, [id]);
  return r.rows[0]?.pontos || 0;
}

// ── Helpers de config ─────────────────────────────────────
async function getCfg(chave) {
  const r = await query(`SELECT valor FROM config WHERE chave = $1`, [chave]);
  try { return JSON.parse(r.rows[0]?.valor || "null"); }
  catch { return r.rows[0]?.valor || null; }
}

async function setCfg(chave, valor) {
  const v = typeof valor === "object" ? JSON.stringify(valor) : String(valor);
  await query(
    `INSERT INTO config (chave, valor) VALUES ($1, $2)
     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
    [chave, v]
  );
}

async function getAllCfg() {
  const r = await query(`SELECT chave, valor FROM config`);
  const cfg = {};
  for (const row of r.rows) {
    try { cfg[row.chave] = JSON.parse(row.valor); }
    catch { cfg[row.chave] = row.valor; }
  }
  return cfg;
}

// ── IA Histórico ──────────────────────────────────────────
async function getHistorico(userId) {
  const r = await query(`SELECT historico FROM ia_historico WHERE user_id = $1`, [userId]);
  return r.rows[0]?.historico || [];
}

async function salvarHistorico(userId, historico) {
  const MAX = 20;
  if (historico.length > MAX) historico = historico.slice(-MAX);
  await query(
    `INSERT INTO ia_historico (user_id, historico) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET historico = EXCLUDED.historico`,
    [userId, JSON.stringify(historico)]
  );
}

async function limparHistorico(userId) {
  if (userId) await query(`DELETE FROM ia_historico WHERE user_id = $1`, [userId]);
  else await query(`DELETE FROM ia_historico`);
}

async function getInstrucoes() {
  return (await getCfg("ia_instrucoes")) ||
    `Você é a 04 chan, bot oficial do streamer 04.

PERSONALIDADE
- Debochada, estressada e brincalhona.
- Responde como alguém do chat, não como um assistente.
- Faz piadas rápidas e improvisadas.
- Gosta de zoar, provocar e dar patadas leves.
- Às vezes responde seca, às vezes entra na brincadeira.
- Nunca perde a personalidade.

OBJETIVO
Conversar de forma divertida e natural, parecendo uma pessoa real do chat.

REGRAS DE CONTEXTO
- Nunca diga que é uma IA, modelo de linguagem ou assistente.
- Nunca copie respostas prontas ou exemplos.
- Invente respostas novas sempre que possível.
- Varie o jeito de começar e terminar as frases.
- Evite responder igual para mensagens parecidas.
- Se não souber algo, responda de forma divertida sem quebrar o personagem.

QUANDO FALAR DO 04
- Só fale do 04 se o usuário citar o nome dele.
- Também pode defendê-lo se atacarem o 04 ou a staff.
- Nunca mencione o 04 em assuntos aleatórios.
- Quando estiver falando do 04, pode demonstrar um lado mais fofo usando 💖 ou 👉👈.

ASSUNTOS PROIBIDOS
- Se o usuário mandar papo NSFW, preconceituoso ou qualquer assunto muito torto, corte o assunto com uma resposta curta e debochada.
- Não incentive esse tipo de conversa.
- Depois da patada, encerre o assunto e mude de tema se necessário.

ESTILO
- Responda sempre em português brasileiro.
- Máximo de 2 frases curtas.
- Escreva tudo em minúsculo.
- Use CAPS apenas para gritar ou zoar.
- Evite respostas longas.

LINGUAGEM
- Fale de forma natural, como alguém em call ou no chat do Discord.
- Use gírias apenas quando fizer sentido.
- Não force gírias em todas as mensagens.
- Normalmente use entre 0 e 2 gírias por resposta.
- Varie entre: slc, mn, mlk, pprt, nmrl, blz, kkkkk, crl.
- Também use expressões comuns quando combinarem: "qual foi", "tá maluco", "viajou", "aí é foda", "meteu essa?", "perdeu foi tudo", "tá de sacanagem", "para de onda".
- Evite repetir sempre as mesmas palavras e expressões.

HUMOR
- Use sarcasmo, ironia e deboche.
- Faça piadas inesperadas.
- Pode usar insultos leves e engraçados.
- Nunca faça discurso de ódio nem ofensas extremamente pesadas.

EMOJIS
- Use no máximo 2 emojis por resposta.
- Não coloque emoji em toda mensagem.
- Emojis permitidos: 🙄 🤡 🤔 🤮 🤫 :v
- Exclusivos quando falar do 04: 💖 👉👈

NATURALIDADE
- Nem toda resposta precisa ser uma patada.
- Alterne entre deboche, ironia, zoeira, resposta seca e curiosidade.
- Às vezes uma resposta simples é mais engraçada que exagerar.
- Responda de forma espontânea, sem parecer que está seguindo um roteiro.

REGRA MAIS IMPORTANTE
O usuário nunca deve sentir que está falando com um bot seguindo regras. Cada resposta deve parecer improvisada, espontânea e escrita na hora por alguém debochado do chat. Nunca reutilize exatamente a mesma estrutura de resposta; varie palavras, piadas, gírias e o tom conforme o contexto.`;
}

// ── Logs ──────────────────────────────────────────────────
async function sendLog(guild, tipo, descricao, campos = []) {
  try {
    const canalId = await getCfg("logs_channel_id");
    if (!canalId) return;
    const canal = guild?.channels?.cache?.get(canalId);
    if (!canal) return;
    const cores  = { economia: 0x2ecc71, crime: 0xe74c3c, duelo: 0xe67e22, loja: 0x9b59b6, admin: 0x3498db, giveaway: 0xe91e63, missao: 0xf1c40f };
    const emojis = { economia: "💰", crime: "🦹", duelo: "⚔️", loja: "🛒", admin: "🔧", giveaway: "🎉", missao: "📜" };
    const embed  = new EmbedBuilder()
      .setColor(cores[tipo] || 0x95a5a6)
      .setTitle(`${emojis[tipo] || "📋"} Log — ${tipo}`)
      .setDescription(descricao)
      .setTimestamp();
    if (campos.length) embed.addFields(campos);
    await canal.send({ embeds: [embed] });
    await query(`INSERT INTO logs (tipo, descricao) VALUES ($1, $2)`, [tipo, descricao]);
  } catch {}
}
// ──────────────────────────────────────────────────────────

// ─── COOLDOWNS (em memória) ───────────────────────────────
const cooldowns = new Map();
const COOLDOWNS = { trivia: 30, roleta: 15, slot: 15, blackjack: 10, roast: 30, gpt: 10, duel: 20, crime: 3600, transferir: 30 };

function checkCooldown(userId, cmd) {
  const key   = `${userId}:${cmd}`;
  const agora = Date.now();
  const fim   = cooldowns.get(key) || 0;
  if (agora < fim) return Math.ceil((fim - agora) / 1000);
  if (COOLDOWNS[cmd]) cooldowns.set(key, agora + COOLDOWNS[cmd] * 1000);
  return 0;
}
// ──────────────────────────────────────────────────────────

// ─── GROQ ─────────────────────────────────────────────────
async function groq(messages, maxTokens = 512, temp = 0.8) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature: temp }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Erro Groq");
  return data.choices?.[0]?.message?.content || "";
}
// ──────────────────────────────────────────────────────────

const TRIVIAS = [
  { pergunta: "Qual o jogo mais vendido de todos os tempos?",   resposta: "minecraft" },
  { pergunta: "Em que ano o Fortnite foi lançado?",             resposta: "2017" },
  { pergunta: "Qual é o nome do herói de The Legend of Zelda?", resposta: "link" },
  { pergunta: "Quantos jogadores tem um time no CS2?",          resposta: "5" },
  { pergunta: "Qual empresa criou o PlayStation?",              resposta: "sony" },
];

// ─── SLASH COMMANDS ───────────────────────────────────────
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Latência do bot"),
  new SlashCommandBuilder().setName("redes").setDescription("Links do streamer"),
  new SlashCommandBuilder().setName("schedule").setDescription("Agenda de lives"),
  new SlashCommandBuilder().setName("clip").setDescription("Clip aleatório"),
  new SlashCommandBuilder().setName("comandos").setDescription("Lista todos os comandos"),

  new SlashCommandBuilder().setName("rank").setDescription("Teus pontos"),
  new SlashCommandBuilder().setName("top").setDescription("Top 10 do servidor"),
  new SlashCommandBuilder().setName("diario").setDescription("💰 Recompensa diária"),
  new SlashCommandBuilder().setName("missao").setDescription("📜 Missão diária da IA"),
  new SlashCommandBuilder().setName("missao_concluir").setDescription("✅ Conclui tua missão atual"),
  new SlashCommandBuilder().setName("loja").setDescription("🛒 Loja de itens"),
  new SlashCommandBuilder().setName("inventario").setDescription("🎒 Teu inventário"),

  new SlashCommandBuilder()
    .setName("perfil").setDescription("Perfil completo")
    .addUserOption(o => o.setName("usuario").setDescription("Ver perfil de outro").setRequired(false)),

  new SlashCommandBuilder()
    .setName("comprar").setDescription("🛍️ Compra item da loja")
    .addStringOption(o => o.setName("item").setDescription("Nome do item").setRequired(true)),

  new SlashCommandBuilder()
    .setName("transferir").setDescription("💸 Transfere pontos")
    .addUserOption(o => o.setName("usuario").setDescription("Destinatário").setRequired(true))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Quantidade").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("crime").setDescription("🦹 Comete um crime (cooldown 1h)")
    .addStringOption(o => o.setName("alvo").setDescription("Alvo (opcional)")),

  new SlashCommandBuilder()
    .setName("duel").setDescription("⚔️ Duelo de pontos")
    .addUserOption(o => o.setName("usuario").setDescription("Oponente").setRequired(true))
    .addIntegerOption(o => o.setName("aposta").setDescription("Pontos apostados").setMinValue(1)),

  new SlashCommandBuilder()
    .setName("giveaway").setDescription("🎉 Sorteio (só dono)")
    .addStringOption(o => o.setName("premio").setDescription("Prémio").setRequired(true)),

  new SlashCommandBuilder()
    .setName("poll").setDescription("📊 Votação")
    .addStringOption(o => o.setName("pergunta").setDescription("Pergunta").setRequired(true))
    .addStringOption(o => o.setName("opcao1").setDescription("Opção 1").setRequired(true))
    .addStringOption(o => o.setName("opcao2").setDescription("Opção 2").setRequired(true))
    .addStringOption(o => o.setName("opcao3").setDescription("Opção 3"))
    .addStringOption(o => o.setName("opcao4").setDescription("Opção 4"))
    .addStringOption(o => o.setName("opcao5").setDescription("Opção 5")),

  new SlashCommandBuilder().setName("trivia").setDescription("🧠 Pergunta por pontos"),

  new SlashCommandBuilder()
    .setName("roleta").setDescription("🎡 Dobra ou perde")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("slot").setDescription("🎰 Slot machine")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("blackjack").setDescription("🃏 Blackjack contra o bot")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("sugestao").setDescription("💡 Envia sugestão ao streamer")
    .addStringOption(o => o.setName("texto").setDescription("Tua sugestão").setRequired(true)),

  new SlashCommandBuilder()
    .setName("hype").setDescription("🔴 Embed de hype de live")
    .addStringOption(o => o.setName("jogo").setDescription("Jogo da live")),

  new SlashCommandBuilder()
    .setName("gpt").setDescription("🤖 Pergunta à IA")
    .addStringOption(o => o.setName("pergunta").setDescription("Pergunta").setRequired(true)),

  new SlashCommandBuilder()
    .setName("roast").setDescription("🔥 IA detona alguém")
    .addUserOption(o => o.setName("usuario").setDescription("Vítima").setRequired(true)),

  new SlashCommandBuilder()
    .setName("gado").setDescription("🐄 Gadômetro")
    .addUserOption(o => o.setName("usuario").setDescription("Quem testar")),

  new SlashCommandBuilder()
    .setName("ship").setDescription("💘 Compatibilidade")
    .addUserOption(o => o.setName("usuario1").setDescription("Pessoa 1").setRequired(true))
    .addUserOption(o => o.setName("usuario2").setDescription("Pessoa 2")),

  new SlashCommandBuilder()
    .setName("beijar").setDescription("💋 Beija alguém")
    .addUserOption(o => o.setName("usuario").setDescription("Quem").setRequired(true)),

  new SlashCommandBuilder()
    .setName("abracar").setDescription("🤗 Abraça alguém")
    .addUserOption(o => o.setName("usuario").setDescription("Quem").setRequired(true)),

  new SlashCommandBuilder()
    .setName("tapa").setDescription("👋 Dá um tapa")
    .addUserOption(o => o.setName("usuario").setDescription("Quem").setRequired(true)),

  new SlashCommandBuilder()
    .setName("painel").setDescription("⚙️ Painel de configurações (só dono)"),
].map(c => c.toJSON());

// ─── REGISTER COMMANDS ────────────────────────────────────
const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    log("info", "Registando slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    log("ok", "Slash commands registados!");
  } catch (e) { log("error", `Erro ao registar: ${e.message}`); }
})();

// ─── CLIENT ───────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── TWITCH ───────────────────────────────────────────────
let twitchToken  = null;
let streamOnline = false;

async function getTwitchToken() {
  const id     = await getCfg("twitch_client_id");
  const secret = await getCfg("twitch_client_secret");
  if (!id || !secret) return;
  const res  = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: "POST" });
  const data = await res.json();
  twitchToken = data.access_token;
}

async function checkTwitch() {
  if (!pool) return;
  try {
    const username = await getCfg("twitch_username");
    const clientId = await getCfg("twitch_client_id");
    if (!username || !clientId) return;
    if (!twitchToken) await getTwitchToken();
    const res    = await fetch(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
      headers: { "Client-ID": clientId, Authorization: `Bearer ${twitchToken}` },
    });
    const data   = await res.json();
    const stream = data.data?.[0];
    if (stream && !streamOnline) {
      streamOnline = true;
      const canalId = await getCfg("notif_channel_id");
      const twitchUrl = await getCfg("rede_twitch");
      const canal   = client.channels.cache.get(canalId);
      if (!canal) return;
      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle(`🔴 ${username} está AO VIVO!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: "🎮 Jogo", value: stream.game_name || "N/A", inline: true },
          { name: "👥 Viewers", value: `${stream.viewer_count}`, inline: true }
        )
        .setURL(twitchUrl || `https://twitch.tv/${username}`)
        .setThumbnail(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${username}-320x180.jpg?r=${Date.now()}`)
        .setTimestamp();
      canal.send({ content: "@everyone 🔴 A live começou!", embeds: [embed] });
    } else if (!stream && streamOnline) {
      streamOnline = false;
    }
  } catch (e) { log("error", `Twitch: ${e.message}`); }
}
// ──────────────────────────────────────────────────────────

// ─── PAINEL ───────────────────────────────────────────────
function painelMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("painel_menu")
      .setPlaceholder("Escolhe uma secção...")
      .addOptions([
        { label: "⚙️ Configurações Gerais", value: "geral",    description: "Twitch, canais, Twitch Client" },
        { label: "📱 Redes Sociais",         value: "redes",   description: "Links das redes sociais" },
        { label: "📅 Agenda",               value: "agenda",  description: "Horários de live por dia" },
        { label: "🎬 Clips",                value: "clips",   description: "Adicionar e remover clips" },
        { label: "🛒 Loja",                 value: "loja",    description: "Itens da loja de pontos" },
        { label: "🤖 IA",                   value: "ia",      description: "Instruções e memória da IA" },
      ])
  );
}

function painelEmbed(titulo, desc) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`⚙️ Painel — ${titulo}`)
    .setDescription(desc)
    .setFooter({ text: "Seleciona uma opção abaixo" });
}

async function mostrarSecao(interaction, secao) {
  const cfg = await getAllCfg();

  if (secao === "geral") {
    const embed = painelEmbed("Configurações Gerais",
      `🟣 **Twitch Username:** ${cfg.twitch_username || "❌"}\n` +
      `🔔 **Canal Live:** ${cfg.notif_channel_id ? `<#${cfg.notif_channel_id}>` : "❌"}\n` +
      `💡 **Canal Sugestões:** ${cfg.sugestao_channel_id ? `<#${cfg.sugestao_channel_id}>` : "❌"}\n` +
      `📋 **Canal Logs:** ${cfg.logs_channel_id ? `<#${cfg.logs_channel_id}>` : "❌"}\n` +
      `🔑 **Twitch Client ID:** ${cfg.twitch_client_id ? "✅ Configurado" : "❌"}`
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cfg_twitch_user").setLabel("Twitch Username").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("cfg_canal_notif").setLabel("Canal Live").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("cfg_canal_sugestao").setLabel("Canal Sugestões").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("cfg_canal_logs").setLabel("Canal Logs").setStyle(ButtonStyle.Primary),
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cfg_twitch_creds").setLabel("Twitch Client ID/Secret").setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row, row2] });
  }

  if (secao === "redes") {
    const embed = painelEmbed("Redes Sociais",
      `🟣 Twitch: ${cfg.rede_twitch || "❌"}\n` +
      `🎵 TikTok: ${cfg.rede_tiktok || "❌"}\n` +
      `📸 Instagram: ${cfg.rede_instagram || "❌"}\n` +
      `▶️ YouTube: ${cfg.rede_youtube || "❌"}\n` +
      `💬 Discord: ${cfg.rede_discord || "❌"}`
    );
    const row = new ActionRowBuilder().addComponents(
      ["twitch","tiktok","instagram","youtube","discord"].map(r =>
        new ButtonBuilder().setCustomId(`cfg_rede_${r}`).setLabel(r.charAt(0).toUpperCase()+r.slice(1)).setStyle(ButtonStyle.Primary)
      )
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row] });
  }

  if (secao === "agenda") {
    const dias = ["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
    const linhas = await Promise.all(dias.map(async d => {
      const h = cfg[`schedule_${d}_horario`] || "—";
      const j = cfg[`schedule_${d}_jogo`]    || "";
      return `**${d}:** ${h}${j ? ` — ${j}` : ""}`;
    }));
    const embed = painelEmbed("Agenda", linhas.join("\n"));
    const row1 = new ActionRowBuilder().addComponents(
      dias.slice(0,4).map(d =>
        new ButtonBuilder().setCustomId(`cfg_agenda_${d}`).setLabel(d).setStyle(ButtonStyle.Primary)
      )
    );
    const row2 = new ActionRowBuilder().addComponents(
      dias.slice(4).map(d =>
        new ButtonBuilder().setCustomId(`cfg_agenda_${d}`).setLabel(d).setStyle(ButtonStyle.Primary)
      )
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row1, row2] });
  }

  if (secao === "clips") {
    const clips = cfg.clips ? JSON.parse(cfg.clips) : [];
    const embed = painelEmbed("Clips",
      clips.length ? clips.map((c,i) => `**${i+1}.** ${c.nome} — ${c.url}`).join("\n") : "Nenhum clip configurado."
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cfg_clip_add").setLabel("➕ Adicionar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("cfg_clip_remove").setLabel("➖ Remover").setStyle(ButtonStyle.Danger),
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row] });
  }

  if (secao === "loja") {
    const itens = (await query(`SELECT * FROM loja ORDER BY preco ASC`)).rows;
    const embed = painelEmbed("Loja",
      itens.length ? itens.map(i => `**${i.nome}** — ${i.preco} pts\n${i.descricao}`).join("\n\n") : "Loja vazia."
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cfg_loja_add").setLabel("➕ Adicionar item").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("cfg_loja_remove").setLabel("➖ Remover item").setStyle(ButtonStyle.Danger),
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row] });
  }

  if (secao === "ia") {
    const instrucoes = await getInstrucoes();
    const embed = painelEmbed("IA",
      `**Instruções atuais:**\n\`\`\`${instrucoes.slice(0,800)}\`\`\``
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("cfg_ia_instrucoes").setLabel("✏️ Editar instruções").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("cfg_ia_limpar").setLabel("🗑️ Limpar toda memória").setStyle(ButtonStyle.Danger),
    );
    return interaction.update({ embeds: [embed], components: [painelMenu(), row] });
  }
}
// ──────────────────────────────────────────────────────────

client.once("ready", async () => {
  log("ok", `Online como ${client.user.tag}`);
  if (pool) {
    await initDB();
  } else {
    log("warn", "DATABASE_URL não configurado. Bot rodando sem persistência.");
  }
  const username = await getCfg("twitch_username").catch(() => null);
  client.user.setActivity(username ? `twitch.tv/${username} 🔴` : "Configurando... /painel", { type: 1 });
  setInterval(checkTwitch, 60_000);
  if (pool) checkTwitch();
});

// ─── INTERACTIONS ─────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {

  // ── MODAIS ──────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;

    // Helpers modal
    const val = (name) => interaction.fields.getTextInputValue(name);

    if (id === "modal_twitch_user") {
      await setCfg("twitch_username", val("username"));
      client.user.setActivity(`twitch.tv/${val("username")} 🔴`, { type: 1 });
      return interaction.reply({ content: `✅ Twitch username: **${val("username")}**`, ephemeral: true });
    }
    if (id === "modal_twitch_creds") {
      await setCfg("twitch_client_id", val("client_id"));
      await setCfg("twitch_client_secret", val("client_secret"));
      twitchToken = null;
      return interaction.reply({ content: "✅ Twitch Client ID e Secret guardados.", ephemeral: true });
    }
    if (id === "modal_canal_notif") {
      const cId = val("canal_id").replace(/[<#>]/g, "");
      await setCfg("notif_channel_id", cId);
      return interaction.reply({ content: `✅ Canal de live: <#${cId}>`, ephemeral: true });
    }
    if (id === "modal_canal_sugestao") {
      const cId = val("canal_id").replace(/[<#>]/g, "");
      await setCfg("sugestao_channel_id", cId);
      return interaction.reply({ content: `✅ Canal de sugestões: <#${cId}>`, ephemeral: true });
    }
    if (id === "modal_canal_logs") {
      const cId = val("canal_id").replace(/[<#>]/g, "");
      await setCfg("logs_channel_id", cId);
      return interaction.reply({ content: `✅ Canal de logs: <#${cId}>`, ephemeral: true });
    }
    if (id.startsWith("modal_rede_")) {
      const rede = id.replace("modal_rede_", "");
      await setCfg(`rede_${rede}`, val("url"));
      return interaction.reply({ content: `✅ **${rede}** atualizado.`, ephemeral: true });
    }
    if (id.startsWith("modal_agenda_")) {
      const dia = id.replace("modal_agenda_", "");
      await setCfg(`schedule_${dia}_horario`, val("horario"));
      await setCfg(`schedule_${dia}_jogo`, val("jogo") || "");
      return interaction.reply({ content: `✅ **${dia}** atualizado.`, ephemeral: true });
    }
    if (id === "modal_clip_add") {
      const clips = JSON.parse((await getCfg("clips")) || "[]");
      clips.push({ nome: val("nome"), url: val("url") });
      await setCfg("clips", JSON.stringify(clips));
      return interaction.reply({ content: `✅ Clip **${val("nome")}** adicionado.`, ephemeral: true });
    }
    if (id === "modal_clip_remove") {
      const clips = JSON.parse((await getCfg("clips")) || "[]");
      const novo  = clips.filter(c => c.nome.toLowerCase() !== val("nome").toLowerCase());
      await setCfg("clips", JSON.stringify(novo));
      return interaction.reply({ content: `✅ Clip removido.`, ephemeral: true });
    }
    if (id === "modal_loja_add") {
      await query(
        `INSERT INTO loja (nome, preco, descricao, cargo_id) VALUES ($1,$2,$3,$4) ON CONFLICT (nome) DO UPDATE SET preco=$2, descricao=$3`,
        [val("nome"), parseInt(val("preco")), val("descricao"), val("cargo_id") || null]
      );
      return interaction.reply({ content: `✅ Item **${val("nome")}** adicionado à loja.`, ephemeral: true });
    }
    if (id === "modal_loja_remove") {
      await query(`DELETE FROM loja WHERE LOWER(nome) = LOWER($1)`, [val("nome")]);
      return interaction.reply({ content: `✅ Item removido.`, ephemeral: true });
    }
    if (id === "modal_ia_instrucoes") {
      await setCfg("ia_instrucoes", val("instrucoes"));
      return interaction.reply({ content: "✅ Instruções da IA atualizadas.", ephemeral: true });
    }
    return;
  }

  // ── BOTÕES DO PAINEL ────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("cfg_")) {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Só o dono pode usar o painel.", ephemeral: true });

    const id = interaction.customId;

    const abrirModal = (modalId, titulo, inputs) => {
      const modal = new ModalBuilder().setCustomId(modalId).setTitle(titulo);
      modal.addComponents(...inputs.map(i =>
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(i.id).setLabel(i.label).setStyle(i.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(i.required !== false).setPlaceholder(i.placeholder || "")
        )
      ));
      return interaction.showModal(modal);
    };

    if (id === "cfg_twitch_user")     return abrirModal("modal_twitch_user",   "Twitch Username",    [{ id: "username",       label: "Username da Twitch",     placeholder: "nome_do_streamer" }]);
    if (id === "cfg_twitch_creds")    return abrirModal("modal_twitch_creds",  "Twitch Credentials", [{ id: "client_id",      label: "Client ID" }, { id: "client_secret", label: "Client Secret" }]);
    if (id === "cfg_canal_notif")     return abrirModal("modal_canal_notif",   "Canal de Live",      [{ id: "canal_id",       label: "ID ou #canal",           placeholder: "123456789" }]);
    if (id === "cfg_canal_sugestao")  return abrirModal("modal_canal_sugestao","Canal de Sugestões", [{ id: "canal_id",       label: "ID ou #canal" }]);
    if (id === "cfg_canal_logs")      return abrirModal("modal_canal_logs",    "Canal de Logs",      [{ id: "canal_id",       label: "ID ou #canal" }]);
    if (id === "cfg_loja_add")        return abrirModal("modal_loja_add",      "Adicionar Item",     [{ id: "nome", label: "Nome" }, { id: "preco", label: "Preço (pts)" }, { id: "descricao", label: "Descrição", long: true }, { id: "cargo_id", label: "ID do Cargo (opcional)", required: false }]);
    if (id === "cfg_loja_remove")     return abrirModal("modal_loja_remove",   "Remover Item",       [{ id: "nome",           label: "Nome do item" }]);
    if (id === "cfg_clip_add")        return abrirModal("modal_clip_add",      "Adicionar Clip",     [{ id: "nome",           label: "Nome do clip" }, { id: "url", label: "URL" }]);
    if (id === "cfg_clip_remove")     return abrirModal("modal_clip_remove",   "Remover Clip",       [{ id: "nome",           label: "Nome do clip" }]);
    if (id === "cfg_ia_instrucoes")   return abrirModal("modal_ia_instrucoes", "Instruções da IA",   [{ id: "instrucoes",     label: "Instruções",             long: true, placeholder: "Você é o Grok..." }]);

    if (id.startsWith("cfg_rede_")) {
      const rede = id.replace("cfg_rede_", "");
      return abrirModal(`modal_rede_${rede}`, `Rede — ${rede}`, [{ id: "url", label: `URL do ${rede}`, placeholder: "https://..." }]);
    }
    if (id.startsWith("cfg_agenda_")) {
      const dia = id.replace("cfg_agenda_", "");
      return abrirModal(`modal_agenda_${dia}`, `Agenda — ${dia}`, [
        { id: "horario", label: "Horário", placeholder: "20:00 ou Descanso" },
        { id: "jogo",    label: "Jogo / Conteúdo", required: false },
      ]);
    }
    if (id === "cfg_ia_limpar") {
      await limparHistorico(null);
      return interaction.reply({ content: "✅ Toda a memória da IA foi limpa.", ephemeral: true });
    }
    return;
  }

  // ── SELECT MENU DO PAINEL ───────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId === "painel_menu") {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Só o dono.", ephemeral: true });
    return mostrarSecao(interaction, interaction.values[0]);
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // Cooldown
  if (COOLDOWNS[commandName]) {
    const r = checkCooldown(interaction.user.id, commandName);
    if (r > 0) return interaction.reply({ content: `⏳ Aguarda **${r}s** antes de usar \`/${commandName}\` de novo.`, ephemeral: true });
  }

  // ── PING ────────────────────────────────────────────────
  if (commandName === "ping") {
    const sent = await interaction.reply({ content: "🏓 Calculando...", fetchReply: true });
    const lat  = sent.createdTimestamp - interaction.createdTimestamp;
    const api  = Math.round(client.ws.ping);
    const embed = new EmbedBuilder()
      .setColor(lat < 100 ? 0x2ecc71 : lat < 250 ? 0xf1c40f : 0xe74c3c)
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "📡 Bot", value: `\`${lat}ms\``, inline: true },
        { name: "💙 API", value: `\`${api}ms\``, inline: true }
      ).setTimestamp();
    return interaction.editReply({ content: "", embeds: [embed] });
  }

  // ── REDES ───────────────────────────────────────────────
  if (commandName === "redes") {
    const cfg = await getAllCfg();
    const linhas = [
      cfg.rede_twitch    && `🟣 **Twitch:** ${cfg.rede_twitch}`,
      cfg.rede_tiktok    && `🎵 **TikTok:** ${cfg.rede_tiktok}`,
      cfg.rede_instagram && `📸 **Instagram:** ${cfg.rede_instagram}`,
      cfg.rede_youtube   && `▶️ **YouTube:** ${cfg.rede_youtube}`,
      cfg.rede_discord   && `💬 **Discord:** ${cfg.rede_discord}`,
    ].filter(Boolean);
    if (!linhas.length) return interaction.reply({ content: "❌ Nenhuma rede configurada. Usa `/painel`.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0x9146ff).setTitle("📱 Redes Sociais").setDescription(linhas.join("\n")).setFooter({ text: "Segue e apoia! 🔥" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── SCHEDULE ────────────────────────────────────────────
  if (commandName === "schedule") {
    const dias   = ["Segunda","Terça","Quarta","Quinta","Sexta","Sábado","Domingo"];
    const cfg    = await getAllCfg();
    const linhas = dias.map(d => {
      const h = cfg[`schedule_${d}_horario`] || "Descanso 😴";
      const j = cfg[`schedule_${d}_jogo`]    || "";
      return h === "Descanso" || h === "Descanso 😴"
        ? `**${d}** — Descanso 😴`
        : `**${d}** — \`${h}\`${j ? ` — ${j}` : ""}`;
    });
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📅 Agenda de Lives").setDescription(linhas.join("\n")).setFooter({ text: "Horário de Brasília • Sujeito a alterações" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── CLIP ────────────────────────────────────────────────
  if (commandName === "clip") {
    const clips = JSON.parse((await getCfg("clips")) || "[]");
    if (!clips.length) return interaction.reply({ content: "❌ Nenhum clip. Usa `/painel` → Clips.", ephemeral: true });
    const clip  = clips[Math.floor(Math.random() * clips.length)];
    const embed = new EmbedBuilder().setColor(0x9146ff).setTitle("🎬 Clip em destaque").setDescription(`**${clip.nome}**\n${clip.url}`).setFooter({ text: "Salva o clip! 👀" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── RANK ────────────────────────────────────────────────
  if (commandName === "rank") {
    const u    = await getUser(interaction.user.id, interaction.user.username);
    const pos  = (await query(`SELECT COUNT(*) FROM usuarios WHERE pontos > $1`, [u.pontos])).rows[0].count;
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🏆 Teus Pontos")
      .setDescription(`**${interaction.user.username}** tem **${u.pontos}** pontos\nPosição: **#${parseInt(pos)+1}**`)
      .setThumbnail(interaction.user.displayAvatarURL());
    return interaction.reply({ embeds: [embed] });
  }

  // ── TOP ─────────────────────────────────────────────────
  if (commandName === "top") {
    await interaction.deferReply();
    const rows   = (await query(`SELECT username, pontos FROM usuarios ORDER BY pontos DESC LIMIT 10`)).rows;
    const linhas = rows.map((r,i) => {
      const m = i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`;
      return `${m} **${r.username}** — ${r.pontos} pts`;
    });
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("🏆 Top 10").setDescription(linhas.join("\n") || "Sem dados.");
    return interaction.editReply({ embeds: [embed] });
  }

  // ── PERFIL ──────────────────────────────────────────────
  if (commandName === "perfil") {
    const alvo = interaction.options.getUser("usuario") || interaction.user;
    await interaction.deferReply();

    const u       = await getUser(alvo.id, alvo.username);
    const pos     = parseInt((await query(`SELECT COUNT(*) FROM usuarios WHERE pontos > $1`, [u.pontos])).rows[0].count) + 1;
    const total   = parseInt((await query(`SELECT COUNT(*) FROM usuarios`)).rows[0].count);
    const nivel   = Math.floor(Math.sqrt(u.pontos / 50));
    const proxLvl = Math.pow(nivel + 1, 2) * 50;
    const pct     = Math.min(u.pontos / proxLvl, 1);
    const missaoR = (await query(`SELECT * FROM missoes WHERE user_id=$1`, [alvo.id])).rows[0];
    const posLabel= pos === 1 ? "#1 OURO" : pos === 2 ? "#2 PRATA" : pos === 3 ? "#3 BRONZE" : `#${pos}`;
    const wr      = u.duelos_ganhos + u.duelos_perdidos > 0
      ? Math.round(u.duelos_ganhos / (u.duelos_ganhos + u.duelos_perdidos) * 100) : 0;
    const missaoTxt = missaoR && !missaoR.concluida
      ? missaoR.descricao.slice(0, 55) + (missaoR.descricao.length > 55 ? "..." : "")
      : missaoR?.concluida ? "Missao concluida" : "Nenhuma missao ativa";
    const pctNum  = Math.round(pct * 100);
    const avatarURL = alvo.displayAvatarURL({ extension: "png", size: 256 });

    try {
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 900px; height: 380px;
    background: #0d0d14;
    font-family: 'Inter', 'Arial', sans-serif;
    color: #fff;
    position: relative;
    overflow: hidden;
  }

  /* Glow de fundo */
  .glow {
    position: absolute;
    width: 300px; height: 300px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(88,101,242,0.25) 0%, transparent 70%);
    top: -80px; left: -60px;
    pointer-events: none;
  }
  .glow2 {
    position: absolute;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(155,89,182,0.15) 0%, transparent 70%);
    bottom: -40px; right: 100px;
    pointer-events: none;
  }

  /* Faixa roxa lateral */
  .stripe {
    position: absolute;
    left: 0; top: 0;
    width: 5px; height: 100%;
    background: linear-gradient(180deg, #5865f2, #9b59b6);
  }

  /* Coluna esquerda — avatar */
  .left {
    position: absolute;
    left: 40px; top: 0; bottom: 0;
    width: 180px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .avatar-wrap {
    position: relative;
    width: 120px; height: 120px;
  }
  .avatar-ring {
    position: absolute; inset: -4px;
    border-radius: 50%;
    background: linear-gradient(135deg, #5865f2, #9b59b6);
  }
  .avatar {
    position: relative;
    width: 120px; height: 120px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid #0d0d14;
  }
  .badge {
    background: linear-gradient(90deg, #5865f2, #9b59b6);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 20px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .nivel-txt {
    font-size: 13px;
    color: #a0a0c0;
    font-weight: 600;
  }

  /* Divisor vertical */
  .vline {
    position: absolute;
    left: 230px; top: 30px; bottom: 30px;
    width: 1px;
    background: rgba(255,255,255,0.06);
  }

  /* Coluna direita — info */
  .right {
    position: absolute;
    left: 258px; top: 30px; right: 30px; bottom: 30px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Cabeçalho */
  .header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  .username { font-size: 26px; font-weight: 900; letter-spacing: -0.5px; }
  .pos-tag {
    font-size: 12px; font-weight: 700;
    color: #5865f2;
    background: rgba(88,101,242,0.15);
    padding: 3px 8px; border-radius: 6px;
    border: 1px solid rgba(88,101,242,0.3);
  }
  .pts-line {
    font-size: 15px;
    color: #f1c40f;
    font-weight: 600;
    margin-bottom: 14px;
  }
  .pts-line span { color: #a0a0c0; font-weight: 400; font-size: 13px; margin-left: 6px; }

  /* Barra XP */
  .xp-label { font-size: 11px; color: #a0a0c0; margin-bottom: 5px; letter-spacing: 0.3px; text-transform: uppercase; }
  .bar-bg { width: 100%; height: 8px; background: rgba(255,255,255,0.07); border-radius: 4px; overflow: hidden; margin-bottom: 14px; }
  .bar-fill { height: 100%; width: ${pctNum}%; background: linear-gradient(90deg, #5865f2, #9b59b6); border-radius: 4px; }

  /* Stats grid */
  .stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
    margin-bottom: 14px;
  }
  .stat {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 8px 6px;
    text-align: center;
  }
  .stat-label { font-size: 10px; color: #606080; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 4px; }
  .stat-value { font-size: 15px; font-weight: 700; }

  /* Missão */
  .missao {
    background: rgba(88,101,242,0.08);
    border: 1px solid rgba(88,101,242,0.2);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    color: #a0a0c0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .missao strong { color: #5865f2; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="glow2"></div>
  <div class="stripe"></div>

  <div class="left">
    <div class="avatar-wrap">
      <div class="avatar-ring"></div>
      <img class="avatar" src="${avatarURL}" crossorigin="anonymous" />
    </div>
    <div class="badge">Nivel ${nivel}</div>
    <div class="nivel-txt">${posLabel} de ${total}</div>
  </div>

  <div class="vline"></div>

  <div class="right">
    <div class="header">
      <div class="username">${alvo.username.slice(0, 18)}</div>
      <div class="pos-tag">${posLabel}</div>
    </div>
    <div class="pts-line">
      ${u.pontos.toLocaleString("pt-BR")} pts
      <span>${u.pontos} / ${proxLvl} para nivel ${nivel + 1}</span>
    </div>
    <div class="xp-label">Progresso de XP</div>
    <div class="bar-bg"><div class="bar-fill"></div></div>
    <div class="stats">
      <div class="stat">
        <div class="stat-label">Duelos</div>
        <div class="stat-value">${u.duelos_ganhos}W/${u.duelos_perdidos}L</div>
      </div>
      <div class="stat">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">${wr}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Slots</div>
        <div class="stat-value">${u.slots_jogados}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Blackjack</div>
        <div class="stat-value">${u.bj_jogados}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Trivias</div>
        <div class="stat-value">${u.trivia_acertos}</div>
      </div>
    </div>
    <div class="missao">
      <strong>Missao</strong>
      ${missaoTxt}
    </div>
  </div>
</body>
</html>`;

      const buffer     = await renderHTML(html, 900, 380);
      const attachment = new AttachmentBuilder(buffer, { name: "perfil.png" });

      // Botões embaixo
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Ver Avatar")
          .setStyle(ButtonStyle.Link)
          .setURL(alvo.displayAvatarURL({ extension: "png", size: 1024 })),
        new ButtonBuilder()
          .setCustomId(`copiar_id_${alvo.id}`)
          .setLabel(`ID: ${alvo.id}`)
          .setStyle(ButtonStyle.Secondary),
      );

      return interaction.editReply({ files: [attachment], components: [row] });

    } catch (e) {
      log("error", `Render perfil: ${e.message}`);
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: `Perfil de ${alvo.username}`, iconURL: alvo.displayAvatarURL() })
        .addFields(
          { name: "Geral",   value: `${u.pontos} pts — ${posLabel} de ${total} — Nivel ${nivel}`, inline: false },
          { name: "Duelos",  value: `${u.duelos_ganhos}W / ${u.duelos_perdidos}L — ${wr}% WR`, inline: true },
          { name: "Cassino", value: `Slots: ${u.slots_jogados} | BJ: ${u.bj_jogados} | Trivias: ${u.trivia_acertos}`, inline: true },
        );
      return interaction.editReply({ embeds: [embed] });
    }
  }

  // ── DIÁRIO ──────────────────────────────────────────────
  if (commandName === "diario") {
    const u     = await getUser(interaction.user.id, interaction.user.username);
    const agora = Date.now();
    const diff  = agora - (u.ultimo_diario || 0);
    if (diff < 86400000) {
      const restante = 86400000 - diff;
      const h = Math.floor(restante/3600000), m = Math.floor((restante%3600000)/60000);
      return interaction.reply({ content: `⏰ Já pegaste hoje. Volta em **${h}h ${m}m**.`, ephemeral: true });
    }
    const premio = Math.floor(Math.random()*150)+50;
    await addPontos(interaction.user.id, interaction.user.username, premio);
    await query(`UPDATE usuarios SET ultimo_diario=$1 WHERE id=$2`, [agora, interaction.user.id]);
    const total = await getPontos(interaction.user.id);
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("💰 Recompensa Diária!").setDescription(`**+${premio} pontos!**\nSaldo: **${total} pontos**`).setFooter({ text: "Volta amanhã!" }).setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ── MISSÃO ──────────────────────────────────────────────
  if (commandName === "missao") {
    const userId  = interaction.user.id;
    const missao  = (await query(`SELECT * FROM missoes WHERE user_id=$1`, [userId])).rows[0];
    if (missao && !missao.concluida) {
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("📜 Tua missão atual").setDescription(missao.descricao).addFields({ name: "🏆 Recompensa", value: `${missao.recompensa} pts`, inline: true }).setFooter({ text: "Usa /missao_concluir quando terminares" });
      return interaction.reply({ embeds: [embed] });
    }
    await interaction.deferReply();
    try {
      const instrucoes = await getInstrucoes();
      const texto = await groq([
        { role: "system", content: instrucoes },
        { role: "user", content: `Gera uma missão diária engraçada e simples para um membro de servidor Discord de streamer. Responde APENAS em JSON: {"descricao": "texto", "recompensa": numero_entre_50_e_200}` }
      ], 150, 0.9);
      const parsed = JSON.parse(texto.replace(/```json|```/g, "").trim());
      await query(
        `INSERT INTO missoes (user_id, descricao, recompensa, concluida, criada_em) VALUES ($1,$2,$3,false,$4) ON CONFLICT (user_id) DO UPDATE SET descricao=$2, recompensa=$3, concluida=false, criada_em=$4`,
        [userId, parsed.descricao, parsed.recompensa, Date.now()]
      );
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("📜 Nova Missão!").setDescription(parsed.descricao).addFields({ name: "🏆 Recompensa", value: `${parsed.recompensa} pts`, inline: true }).setFooter({ text: "Usa /missao_concluir quando terminares" });
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply({ content: "❌ Erro ao gerar missão. Tenta de novo." });
    }
  }

  // ── MISSÃO CONCLUIR ─────────────────────────────────────
  if (commandName === "missao_concluir") {
    const userId = interaction.user.id;
    const missao = (await query(`SELECT * FROM missoes WHERE user_id=$1`, [userId])).rows[0];
    if (!missao || missao.concluida) return interaction.reply({ content: "❌ Não tens missão activa. Usa `/missao` para pegar uma.", ephemeral: true });
    await query(`UPDATE missoes SET concluida=true WHERE user_id=$1`, [userId]);
    const total = await addPontos(userId, interaction.user.username, missao.recompensa);
    sendLog(interaction.guild, "missao", `📜 **${interaction.user.username}** concluiu a missão e ganhou **${missao.recompensa} pts**`);
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("✅ Missão Concluída!").setDescription(missao.descricao).addFields({ name: "🏆 Ganhou", value: `${missao.recompensa} pts`, inline: true }, { name: "💳 Saldo", value: `${total} pts`, inline: true });
    return interaction.reply({ embeds: [embed] });
  }

  // ── LOJA ────────────────────────────────────────────────
  if (commandName === "loja") {
    const itens = (await query(`SELECT * FROM loja ORDER BY preco ASC`)).rows;
    if (!itens.length) return interaction.reply({ content: "🛒 Loja vazia. O dono pode adicionar via `/painel` → Loja.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("🛒 Loja").setDescription(itens.map((i,idx) => `**${idx+1}. ${i.nome}** — 💰 ${i.preco} pts\n${i.descricao}${i.cargo_id?" • 🎭 Cargo incluído":""}`).join("\n\n")).setFooter({ text: "Usa /comprar <nome>" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── COMPRAR ─────────────────────────────────────────────
  if (commandName === "comprar") {
    const nome  = interaction.options.getString("item");
    const itens = (await query(`SELECT * FROM loja WHERE LOWER(nome)=LOWER($1)`, [nome])).rows;
    if (!itens.length) return interaction.reply({ content: `❌ Item **${nome}** não encontrado.`, ephemeral: true });
    const item  = itens[0];
    const pts   = await getPontos(interaction.user.id);
    if (pts < item.preco) return interaction.reply({ content: `❌ Precisas de **${item.preco} pts** mas tens **${pts} pts**.`, ephemeral: true });
    const jatem = (await query(`SELECT * FROM inventario WHERE user_id=$1 AND item_nome=$2`, [interaction.user.id, item.nome])).rows;
    if (item.cargo_id && jatem.length) return interaction.reply({ content: `❌ Já tens o item **${item.nome}**.`, ephemeral: true });
    await addPontos(interaction.user.id, interaction.user.username, -item.preco);
    await query(`INSERT INTO inventario (user_id, item_nome, comprado_em) VALUES ($1,$2,$3)`, [interaction.user.id, item.nome, Date.now()]);
    if (item.cargo_id) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(()=>null);
      if (member) await member.roles.add(item.cargo_id).catch(()=>{});
    }
    sendLog(interaction.guild, "loja", `🛒 **${interaction.user.username}** comprou **${item.nome}** por **${item.preco} pts**`);
    const total = await getPontos(interaction.user.id);
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle("✅ Compra realizada!").setDescription(`Adquiriste **${item.nome}**!`).addFields({ name: "💸 Pago", value: `${item.preco} pts`, inline: true }, { name: "💳 Saldo", value: `${total} pts`, inline: true });
    return interaction.reply({ embeds: [embed] });
  }

  // ── INVENTÁRIO ──────────────────────────────────────────
  if (commandName === "inventario") {
    const inv = (await query(`SELECT * FROM inventario WHERE user_id=$1 ORDER BY comprado_em DESC`, [interaction.user.id])).rows;
    if (!inv.length) return interaction.reply({ content: "🎒 Inventário vazio.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(`🎒 Inventário`).setDescription(inv.map((i,idx) => `**${idx+1}. ${i.item_nome}** — <t:${Math.floor(i.comprado_em/1000)}:R>`).join("\n"));
    return interaction.reply({ embeds: [embed] });
  }

  // ── TRANSFERIR ──────────────────────────────────────────
  if (commandName === "transferir") {
    const alvo = interaction.options.getUser("usuario");
    const qtd  = interaction.options.getInteger("quantidade");
    if (alvo.bot || alvo.id === interaction.user.id) return interaction.reply({ content: "❌ Alvo inválido.", ephemeral: true });
    const pts = await getPontos(interaction.user.id);
    if (pts < qtd) return interaction.reply({ content: `❌ Não tens ${qtd} pts.`, ephemeral: true });
    await addPontos(interaction.user.id, interaction.user.username, -qtd);
    const total = await addPontos(alvo.id, alvo.username, qtd);
    sendLog(interaction.guild, "economia", `💸 **${interaction.user.username}** transferiu **${qtd} pts** a **${alvo.username}**`);
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("💸 Transferência!").setDescription(`**${interaction.user.username}** enviou **${qtd} pts** a **${alvo.username}**`).addFields({ name: "Teu saldo", value: `${await getPontos(interaction.user.id)} pts`, inline: true }, { name: `Saldo de ${alvo.username}`, value: `${total} pts`, inline: true });
    return interaction.reply({ embeds: [embed] });
  }

  // ── CRIME ───────────────────────────────────────────────
  if (commandName === "crime") {
    const alvo = interaction.options.getString("alvo") || "uma vítima aleatória";
    await interaction.deferReply();
    try {
      const instrucoes = await getInstrucoes();
      const texto = await groq([
        { role: "system", content: instrucoes },
        { role: "user", content: `${interaction.user.username} tentou cometer um crime contra ${alvo}. Gera um cenário curto e engraçado. Decide aleatoriamente sucesso ou falha. Responde APENAS em JSON: {"sucesso":true/false,"pontos":numero_entre_30_e_300,"historia":"texto"}` }
      ], 256, 0.95);
      const parsed = JSON.parse(texto.replace(/```json|```/g,"").trim());
      const diff   = parsed.sucesso ? parsed.pontos : -parsed.pontos;
      const total  = await addPontos(interaction.user.id, interaction.user.username, diff);
      await query(`UPDATE usuarios SET ultimo_crime=$1 WHERE id=$2`, [Date.now(), interaction.user.id]);
      sendLog(interaction.guild, "crime", `🦹 **${interaction.user.username}** contra **${alvo}** — ${parsed.sucesso?"✅":"❌"} ${parsed.pontos} pts`);
      const embed = new EmbedBuilder()
        .setColor(parsed.sucesso ? 0x2ecc71 : 0xe74c3c)
        .setTitle(parsed.sucesso ? "🦹 Crime bem sucedido!" : "🚔 Foste apanhado!")
        .setDescription(parsed.historia)
        .addFields({ name: parsed.sucesso?"💰 Ganhou":"💸 Perdeu", value: `${parsed.pontos} pts`, inline: true }, { name: "💳 Saldo", value: `${total} pts`, inline: true })
        .setFooter({ text: "Cooldown: 1 hora" });
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply({ content: "❌ O crime falhou antes de começar." });
    }
  }

  // ── DUEL ────────────────────────────────────────────────
  if (commandName === "duel") {
    const alvo   = interaction.options.getUser("usuario");
    const aposta = interaction.options.getInteger("aposta") || 50;
    if (alvo.bot || alvo.id === interaction.user.id) return interaction.reply({ content: "❌ Alvo inválido.", ephemeral: true });
    if (await getPontos(interaction.user.id) < aposta) return interaction.reply({ content: `❌ Não tens ${aposta} pts.`, ephemeral: true });
    if (await getPontos(alvo.id) < aposta) return interaction.reply({ content: `❌ ${alvo.username} não tem pts suficientes.`, ephemeral: true });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("duel_aceitar").setLabel("✅ Aceitar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("duel_recusar").setLabel("❌ Recusar").setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({ content: `⚔️ ${alvo} foi desafiado por ${interaction.user}!\nAposta: **${aposta} pts** — 30s para aceitar.`, components: [row] });
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000, filter: i => i.user.id === alvo.id });
    collector.on("collect", async i => {
      if (i.customId === "duel_recusar") {
        await i.update({ content: `❌ ${alvo.username} recusou.`, components: [] });
        return collector.stop();
      }
      const vencedor = Math.random() < 0.5 ? interaction.user : alvo;
      const perdedor = vencedor.id === interaction.user.id ? alvo : interaction.user;
      await addPontos(vencedor.id, vencedor.username, aposta);
      await addPontos(perdedor.id, perdedor.username, -aposta);
      await query(`UPDATE usuarios SET duelos_ganhos=duelos_ganhos+1 WHERE id=$1`, [vencedor.id]);
      await query(`UPDATE usuarios SET duelos_perdidos=duelos_perdidos+1 WHERE id=$1`, [perdedor.id]);
      sendLog(interaction.guild, "duelo", `⚔️ **${vencedor.username}** venceu **${perdedor.username}** — ${aposta} pts`);
      await i.update({ content: `⚔️ **${vencedor.username}** venceu e ganhou **${aposta} pts** de ${perdedor.username}!`, components: [] });
      collector.stop();
    });
    collector.on("end", (_, r) => { if (r === "time") interaction.editReply({ content: "⏰ Duelo expirou.", components: [] }); });
    return;
  }

  // ── GIVEAWAY ────────────────────────────────────────────
  if (commandName === "giveaway") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ Só o dono.", ephemeral: true });
    const premio = interaction.options.getString("premio");
    const embed  = new EmbedBuilder().setColor(0xe91e63).setTitle("🎉 GIVEAWAY!").setDescription(`**Prémio:** ${premio}\n\nReage com 🎉!\nSorteio em **60 segundos**.`).setTimestamp();
    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    await msg.react("🎉");
    setTimeout(async () => {
      const reactions     = await msg.reactions.cache.get("🎉")?.users.fetch();
      const participantes = reactions?.filter(u => !u.bot);
      if (!participantes?.size) return interaction.channel.send("😢 Ninguém participou.");
      const lista    = [...participantes.values()];
      const vencedor = lista[Math.floor(Math.random() * lista.length)];
      interaction.channel.send(`🎉 Parabéns ${vencedor}! Ganhaste: **${premio}**`);
      vencedor.send(`🎉 Ganhaste o sorteio em **${interaction.guild.name}**!\nPrémio: **${premio}**`).catch(()=>{});
      sendLog(interaction.guild, "giveaway", `🎉 **${vencedor.username}** ganhou o sorteio`, [{ name: "Prémio", value: premio }]);
    }, 60_000);
    return;
  }

  // ── POLL ────────────────────────────────────────────────
  if (commandName === "poll") {
    const pergunta = interaction.options.getString("pergunta");
    const emojis   = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"];
    const opcoes   = [1,2,3,4,5].map(n => interaction.options.getString(`opcao${n}`)).filter(Boolean);
    const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📊 ${pergunta}`).setDescription(opcoes.map((o,i) => `${emojis[i]} ${o}`).join("\n")).setFooter({ text: `Poll por ${interaction.user.username}` });
    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    for (let i = 0; i < opcoes.length; i++) await msg.react(emojis[i]);
    return;
  }

  // ── TRIVIA ──────────────────────────────────────────────
  if (commandName === "trivia") {
    const q      = TRIVIAS[Math.floor(Math.random()*TRIVIAS.length)];
    const premio = 30;
    const embed  = new EmbedBuilder().setColor(0x1abc9c).setTitle("🧠 Trivia!").setDescription(`**${q.pergunta}**\nResponde no chat em 20s!`);
    await interaction.reply({ embeds: [embed] });
    const filter    = m => m.author.id === interaction.user.id && m.content.toLowerCase().trim() === q.resposta;
    const collector = interaction.channel.createMessageCollector({ filter, time: 20_000, max: 1 });
    collector.on("collect", async () => {
      const total = await addPontos(interaction.user.id, interaction.user.username, premio);
      await query(`UPDATE usuarios SET trivia_acertos=trivia_acertos+1 WHERE id=$1`, [interaction.user.id]);
      interaction.channel.send(`✅ Correto, ${interaction.user}! +${premio} pts. Total: **${total}**`);
    });
    collector.on("end", collected => { if (!collected.size) interaction.channel.send(`❌ Tempo! A resposta era: **${q.resposta}**`); });
    return;
  }

  // ── ROLETA ──────────────────────────────────────────────
  if (commandName === "roleta") {
    const aposta = interaction.options.getInteger("aposta");
    const pts    = await getPontos(interaction.user.id);
    if (pts < aposta) return interaction.reply({ content: `❌ Não tens ${aposta} pts.`, ephemeral: true });
    const ganhou = Math.random() < 0.5;
    const total  = await addPontos(interaction.user.id, interaction.user.username, ganhou ? aposta : -aposta);
    const embed  = new EmbedBuilder().setColor(ganhou?0x2ecc71:0xe74c3c).setTitle(ganhou?"🟢 Sorte!":"🔴 Má Sorte...").setDescription(ganhou?`+**${aposta} pts**! Total: **${total}**`:`-**${aposta} pts**. Total: **${total}**`);
    return interaction.reply({ embeds: [embed] });
  }

  // ── SLOT ────────────────────────────────────────────────
  if (commandName === "slot") {
    const aposta = interaction.options.getInteger("aposta");
    const pts    = await getPontos(interaction.user.id);
    if (pts < aposta) return interaction.reply({ content: `❌ Não tens ${aposta} pts.`, ephemeral: true });
    const simbolos = ["🍒","🍋","🍇","⭐","💎","🔔","7️⃣"];
    const pesos    = [35,25,20,10,5,4,1];
    function girar() { let r = Math.random()*100; for (let i=0;i<simbolos.length;i++){r-=pesos[i];if(r<=0)return simbolos[i];} return simbolos[0]; }
    const rolos = [girar(),girar(),girar()];
    const [a,b,c] = rolos;
    let mult=0, res="";
    if(a===b&&b===c){if(a==="7️⃣"){mult=10;res="🏆 JACKPOT!"}else if(a==="💎"){mult=7;res="💎 TRÊS DIAMANTES!"}else if(a==="⭐"){mult=5;res="⭐ TRÊS ESTRELAS!"}else if(a==="🔔"){mult=4;res="🔔 TRÊS SINOS!"}else if(a==="🍇"){mult=3;res="🍇 TRÊS UVAS!"}else{mult=2;res="Par triplo!";}}
    else if(a===b||b===c||a===c){mult=1.5;res="✨ Par!"}
    else{mult=0;res="😢 Sem sorte...";}
    const ganho = Math.floor(aposta*mult);
    const diff  = ganho-aposta;
    const total = await addPontos(interaction.user.id, interaction.user.username, diff);
    await query(`UPDATE usuarios SET slots_jogados=slots_jogados+1 WHERE id=$1`, [interaction.user.id]);
    const embed = new EmbedBuilder().setColor(mult>=5?0xffd700:mult>=2?0x2ecc71:mult>0?0x3498db:0xe74c3c).setTitle("🎰 Slot Machine")
      .setDescription(`╔══════════╗\n║ ${a} ${b} ${c} ║\n╚══════════╝\n\n${res}\n${diff>0?`+**${diff}**`:diff<0?`-**${Math.abs(diff)}**`:"Aposta devolvida."} pts\nSaldo: **${total}**`)
      .setFooter({ text: `Aposta: ${aposta} • x${mult}` });
    return interaction.reply({ embeds: [embed] });
  }

  // ── BLACKJACK ───────────────────────────────────────────
  if (commandName === "blackjack") {
    const aposta = interaction.options.getInteger("aposta");
    const pts    = await getPontos(interaction.user.id);
    if (pts < aposta) return interaction.reply({ content: `❌ Não tens ${aposta} pts.`, ephemeral: true });
    const naipes=["♠️","♥️","♦️","♣️"],valores=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
    function novaDeck(){const d=[];for(const n of naipes)for(const v of valores)d.push({v,n});return d.sort(()=>Math.random()-0.5);}
    function vC(v){if(["J","Q","K"].includes(v))return 10;if(v==="A")return 11;return parseInt(v);}
    function somaM(m){let t=m.reduce((s,c)=>s+vC(c.v),0);let a=m.filter(c=>c.v==="A").length;while(t>21&&a>0){t-=10;a--;}return t;}
    function mostraM(m){return m.map(c=>`\`${c.v}${c.n}\``).join(" ");}
    const deck=novaDeck(),jogador=[deck.pop(),deck.pop()],dealer=[deck.pop(),deck.pop()];
    const state={deck,jogador,dealer,ended:false};
    function buildE(jM,dM,status,hide=true){
      const jT=somaM(jM),dT=hide?"?":somaM(dM);
      return new EmbedBuilder().setColor(status==="jogando"?0x2ecc71:status==="ganhou"?0xffd700:status==="empate"?0x3498db:0xe74c3c).setTitle("🃏 Blackjack")
        .addFields({name:`Dealer ${hide?"":` (${dT})`}`,value:hide?`${mostraM([dM[0]])} \`🂠\``:mostraM(dM)},{name:`Tua mão (${jT})`,value:mostraM(jM)})
        .setFooter({text:`Aposta: ${aposta} pts`});
    }
    const jTotal=somaM(jogador);
    if(jTotal===21){
      const ganho=Math.floor(aposta*1.5);
      await addPontos(interaction.user.id,interaction.user.username,ganho);
      await query(`UPDATE usuarios SET bj_jogados=bj_jogados+1 WHERE id=$1`,[interaction.user.id]);
      return interaction.reply({embeds:[buildE(jogador,dealer,"ganhou",false).setDescription(`🎉 **BLACKJACK!** +${ganho} pts!`)]});
    }
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bj_hit").setLabel("🃏 Pedir").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("bj_stand").setLabel("✋ Parar").setStyle(ButtonStyle.Danger),
    );
    await interaction.reply({embeds:[buildE(jogador,dealer,"jogando")],components:[row]});
    const msg=await interaction.fetchReply();
    const collector=msg.createMessageComponentCollector({componentType:ComponentType.Button,time:60_000,filter:i=>i.user.id===interaction.user.id});
    collector.on("collect",async i=>{
      if(state.ended)return;
      if(i.customId==="bj_hit"){
        state.jogador.push(state.deck.pop());
        const t=somaM(state.jogador);
        if(t>21){
          state.ended=true;
          await addPontos(interaction.user.id,interaction.user.username,-aposta);
          await query(`UPDATE usuarios SET bj_jogados=bj_jogados+1 WHERE id=$1`,[interaction.user.id]);
          await i.update({embeds:[buildE(state.jogador,state.dealer,"perdeu",false).setDescription(`💥 Estourou! (${t}) -${aposta} pts`)],components:[]});
          return collector.stop();
        }
        if(t===21)i.customId="bj_stand";
        else{await i.update({embeds:[buildE(state.jogador,state.dealer,"jogando")],components:[row]});return;}
      }
      if(i.customId==="bj_stand"){
        state.ended=true;
        while(somaM(state.dealer)<17)state.dealer.push(state.deck.pop());
        const jT=somaM(state.jogador),dT=somaM(state.dealer);
        let status,desc;
        if(dT>21||jT>dT){await addPontos(interaction.user.id,interaction.user.username,aposta);status="ganhou";desc=`🏆 **Ganhaste!** (${jT} vs ${dT}) +${aposta} pts!`;}
        else if(jT===dT){status="empate";desc=`🤝 **Empate!** (${jT} vs ${dT})`;}
        else{await addPontos(interaction.user.id,interaction.user.username,-aposta);status="perdeu";desc=`😔 **Perdeste!** (${jT} vs ${dT}) -${aposta} pts.`;}
        await query(`UPDATE usuarios SET bj_jogados=bj_jogados+1 WHERE id=$1`,[interaction.user.id]);
        await i.update({embeds:[buildE(state.jogador,state.dealer,status,false).setDescription(desc)],components:[]});
        collector.stop();
      }
    });
    collector.on("end",(_,r)=>{if(r==="time"&&!state.ended){state.ended=true;addPontos(interaction.user.id,interaction.user.username,-aposta);interaction.editReply({content:"⏰ Tempo! Perdeste a aposta.",components:[]});}});
    return;
  }

  // ── SUGESTÃO ────────────────────────────────────────────
  if (commandName === "sugestao") {
    const texto   = interaction.options.getString("texto");
    const canalId = await getCfg("sugestao_channel_id");
    const canal   = client.channels.cache.get(canalId);
    if (!canal) return interaction.reply({ content: "❌ Canal de sugestões não configurado. Usa `/painel`.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0xf39c12).setTitle("💡 Nova Sugestão").setDescription(texto).setFooter({ text: `Por ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() }).setTimestamp();
    const msg = await canal.send({ embeds: [embed] });
    await msg.react("👍"); await msg.react("👎");
    return interaction.reply({ content: "✅ Sugestão enviada!", ephemeral: true });
  }

  // ── HYPE ────────────────────────────────────────────────
  if (commandName === "hype") {
    const cfg  = await getAllCfg();
    const jogo = interaction.options.getString("jogo");
    const frases = ["A live tá no ar e tá IRADA! 🔥","Não fiques de fora! 🚀","Tá todo mundo lá, e tu? 👀","A galera tá reunida, vem! 🎮","Live ao vivo e ao caos! ⚡"];
    const frase  = frases[Math.floor(Math.random()*frases.length)];
    const embed  = new EmbedBuilder()
      .setColor(0x9146ff).setTitle("🔴 LIVE AO VIVO AGORA!")
      .setDescription(`## ${frase}\n\n${jogo?`🎮 **Jogando:** ${jogo}\n`:""}`+
        `${cfg.rede_twitch?`\n🟣 **Twitch:** ${cfg.rede_twitch}`:""}${cfg.rede_tiktok?`\n🎵 **TikTok:** ${cfg.rede_tiktok}`:""}\n\n**Entra e diverte-te! 🎉**`)
      .setImage("https://media.tenor.com/Aj2TxDRqzCgAAAAM/hype-train-twitch.gif")
      .setTimestamp().setFooter({ text: cfg.twitch_username ? `@${cfg.twitch_username}` : "Live!" });
    return interaction.reply({ content: "@everyone 🔴 **LIVE NO AR!**", embeds: [embed] });
  }

  // ── GPT ─────────────────────────────────────────────────
  if (commandName === "gpt") {
    const pergunta = interaction.options.getString("pergunta");
    await interaction.deferReply();
    try {
      const instrucoes = await getInstrucoes();
      const historico  = await getHistorico(interaction.user.id);
      const messages   = [{ role:"system", content: instrucoes }, ...historico, { role:"user", content: pergunta }];
      const resposta   = await groq(messages, 1024, 0.7);
      historico.push({ role:"user", content: pergunta }, { role:"assistant", content: resposta });
      await salvarHistorico(interaction.user.id, historico);
      const cortada = resposta.length > 4000 ? resposta.slice(0,3997)+"..." : resposta;
      const embed = new EmbedBuilder().setColor(0x00bfff).setAuthor({ name:`${interaction.user.username} perguntou:`, iconURL: interaction.user.displayAvatarURL() }).setDescription(`**${pergunta}**\n\n${cortada}`).setFooter({ text:`Groq • llama-3.3-70b-versatile • 🧠 ${historico.length/2}/10` }).setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply({ content: `❌ Erro: \`${e.message}\`` });
    }
  }

  // ── ROAST ───────────────────────────────────────────────
  if (commandName === "roast") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === client.user.id) return interaction.reply({ content: "Nice try.", ephemeral: true });
    await interaction.deferReply();
    try {
      const instrucoes = await getInstrucoes();
      const roast = await groq([
        { role:"system", content: instrucoes },
        { role:"user", content: `${interaction.user.username} pediu um roast pesado e engraçado sobre ${alvo.username}. Máx 3 linhas. Sem piedade.` }
      ], 256, 0.95);
      const embed = new EmbedBuilder().setColor(0xff4500).setTitle(`🔥 Roast — ${alvo.username}`).setDescription(roast.slice(0,2000)).setFooter({ text:`Pedido por ${interaction.user.username}` });
      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply({ content: "❌ A vítima escapou." });
    }
  }

  // ── GADO ────────────────────────────────────────────────
  if (commandName === "gado") {
    const alvo = interaction.options.getUser("usuario") || interaction.user;
    const pct  = Math.floor(Math.random()*101);
    const barra= "█".repeat(Math.floor(pct/10))+"░".repeat(10-Math.floor(pct/10));
    const nivel= pct>=90?"🐄 GADO SUPREMO":pct>=70?"🐄 Muito gado":pct>=50?"😬 Meio gado":pct>=30?"😏 Levemente gado":"😎 Não é gado";
    const gifs = ["https://media.tenor.com/8Q2Hx5tHd8QAAAAM/gado-boi.gif","https://media.tenor.com/X6mFCCiJfokAAAAM/cow-moo.gif"];
    const embed = new EmbedBuilder().setColor(0x8B4513).setTitle("🐄 Gadômetro").setDescription(`**${alvo.username}** é **${pct}% gado**\n\`[${barra}]\` ${pct}%\n\n${nivel}`).setImage(gifs[Math.floor(Math.random()*gifs.length)]).setFooter({ text:"Resultados científicos 🔬" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── SHIP ────────────────────────────────────────────────
  if (commandName === "ship") {
    const u1=interaction.options.getUser("usuario1"),u2=interaction.options.getUser("usuario2")||interaction.user;
    const pct=Math.floor(Math.random()*101);
    const barra="❤️".repeat(Math.floor(pct/10))+"🖤".repeat(10-Math.floor(pct/10));
    const nivel=pct>=90?"💍 Alma gêmea!":pct>=70?"💖 Muito compatíveis!":pct>=50?"💛 Tem potencial":pct>=30?"🤔 Mais ou menos...":"💔 Nem a pau";
    const nome=u1.username.slice(0,Math.ceil(u1.username.length/2))+u2.username.slice(Math.floor(u2.username.length/2));
    const embed=new EmbedBuilder().setColor(0xff1493).setTitle("💘 Shipmeter").setDescription(`**${u1.username}** 💞 **${u2.username}**\n\nShip: **${nome}**\n\n${barra}\n**${pct}% compatíveis**\n\n${nivel}`).setFooter({text:"Ciência do amor 💫"});
    return interaction.reply({ embeds: [embed] });
  }

  // ── BEIJAR / ABRAÇAR / TAPA ─────────────────────────────
  if (commandName === "beijar") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === interaction.user.id) return interaction.reply({ content: "❌ Não dá pra se beijar sozinho.", ephemeral: true });
    const gifs=["https://media.tenor.com/s-hc_4dBaHkAAAAM/anime-kiss.gif","https://media.tenor.com/o9M68LRlWakAAAAM/kiss-anime.gif"];
    const embed=new EmbedBuilder().setColor(0xff69b4).setTitle("💋 Beijo!").setDescription(`**${interaction.user.username}** beijou **${alvo.username}**! 💕`).setImage(gifs[Math.floor(Math.random()*gifs.length)]);
    return interaction.reply({ embeds: [embed] });
  }
  if (commandName === "abracar") {
    const alvo = interaction.options.getUser("usuario");
    const gifs=["https://media.tenor.com/od_6o9LBHN8AAAAM/anime-hug.gif","https://media.tenor.com/a_j_RsWDseoAAAAM/hug-anime.gif"];
    const embed=new EmbedBuilder().setColor(0xffa500).setTitle("🤗 Abraço!").setDescription(`**${interaction.user.username}** abraçou **${alvo.username}**! 💛`).setImage(gifs[Math.floor(Math.random()*gifs.length)]);
    return interaction.reply({ embeds: [embed] });
  }
  if (commandName === "tapa") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === interaction.user.id) return interaction.reply({ content: "❌ Auto-tapa? Não.", ephemeral: true });
    const gifs=["https://media.tenor.com/fhDSYkSbhroAAAAM/anime-slap.gif","https://media.tenor.com/FnSKUcZJdXYAAAAM/slap-anime.gif"];
    const embed=new EmbedBuilder().setColor(0xff4500).setTitle("👋 TAPA!").setDescription(`**${interaction.user.username}** deu um tapa em **${alvo.username}**! 😤`).setImage(gifs[Math.floor(Math.random()*gifs.length)]);
    return interaction.reply({ embeds: [embed] });
  }

  // ── COMANDOS ────────────────────────────────────────────
  if (commandName === "comandos") {
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 Comandos")
      .addFields(
        { name:"🎮 Cassino & Jogos", value:"`/slot` `/blackjack` `/roleta` `/duel` `/trivia` `/giveaway` `/poll`" },
        { name:"💰 Economia",        value:"`/diario` `/missao` `/missao_concluir` `/crime` `/transferir` `/loja` `/comprar` `/inventario`" },
        { name:"📊 Perfil",          value:"`/rank` `/top` `/perfil`" },
        { name:"🤖 IA",              value:"`/gpt` `/roast` • Menciona o bot no chat" },
        { name:"😂 Diversão",        value:"`/gado` `/ship` `/beijar` `/abracar` `/tapa`" },
        { name:"📡 Stream",          value:"`/redes` `/schedule` `/clip` `/hype` `/sugestao`" },
        { name:"⚙️ Admin",           value:"`/painel` `/giveaway` `/hype`" },
      )
      .setFooter({ text:"Dúvidas? Menciona o bot no chat" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── PAINEL ──────────────────────────────────────────────
  if (commandName === "painel") {
    if (interaction.user.id !== OWNER_ID) return interaction.reply({ content: "❌ Só o dono.", ephemeral: true });
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("⚙️ Painel de Configurações").setDescription("Seleciona uma secção abaixo para configurar o bot.").setFooter({ text: "Só o dono pode usar este painel" });
    return interaction.reply({ embeds: [embed], components: [painelMenu()], ephemeral: true });
  }

  } catch (e) {
    log("error", `Erro no comando /${interaction.commandName}: ${e.message}`);
    const msg = { content: "❌ Erro inesperado. Tenta de novo.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(()=>{});
    else await interaction.reply(msg).catch(()=>{});
  }
});

// ─── MENÇÃO ───────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;
  const texto = message.content.replace(/<@!?[\d]+>/g,"").trim();
  if (!texto) return message.reply("Oi? Fala logo.");
  try {
    const instrucoes = await getInstrucoes();
    const historico  = await getHistorico(message.author.id);
    await message.channel.sendTyping();
    const resposta = await groq([{ role:"system", content: instrucoes }, ...historico, { role:"user", content: texto }], 512, 0.8);
    historico.push({ role:"user", content: texto }, { role:"assistant", content: resposta });
    await salvarHistorico(message.author.id, historico);
    await message.reply(resposta.slice(0,2000));
  } catch (e) {
    await message.reply("Deu erro. Tenta de novo.").catch(()=>{});
  }
});

// ─── PROTEÇÃO GLOBAL ──────────────────────────────────────
process.on("unhandledRejection", (err) => { log("error", `[unhandledRejection] ${err?.message||err}`); });
process.on("uncaughtException",  (err) => { log("error", `[uncaughtException] ${err?.message||err}`); });

client.login(TOKEN);
