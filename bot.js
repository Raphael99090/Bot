const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const fs = require("fs");

// ─── CONFIG FIXA (não muda por comando) ───────────────────
const TOKEN        = process.env.TOKEN        || "SEU_TOKEN_AQUI";
const CLIENT_ID    = process.env.CLIENT_ID    || "SEU_CLIENT_ID_AQUI";
const OWNER_ID     = process.env.OWNER_ID     || "SEU_ID_AQUI";
const GROQ_API_KEY = process.env.GROQ_API_KEY || "SUA_GROQ_API_KEY_AQUI";
// ──────────────────────────────────────────────────────────

// ─── DATABASE ─────────────────────────────────────────────
const DB_FILE = "./data.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const inicial = {
        pontos: {},
        config: {
          twitch_username:     "",
          notif_channel_id:    "",
          sugestao_channel_id: "",
          redes: { twitch: "", tiktok: "", instagram: "", youtube: "", discord: "" },
          schedule: [
            { dia: "Segunda", horario: "Descanso 😴", jogo: "" },
            { dia: "Terça",   horario: "20:00",        jogo: "Variety" },
            { dia: "Quarta",  horario: "20:00",        jogo: "Variety" },
            { dia: "Quinta",  horario: "20:00",        jogo: "Variety" },
            { dia: "Sexta",   horario: "21:00",        jogo: "Live principal 🔴" },
            { dia: "Sábado",  horario: "18:00",        jogo: "Live principal 🔴" },
            { dia: "Domingo", horario: "Descanso 😴",  jogo: "" },
          ],
          clips: [],
        },
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(inicial, null, 2));
      return inicial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch (e) {
    console.error("Erro ao ler data.json:", e.message);
    return { pontos: {}, config: { twitch_username: "", notif_channel_id: "", sugestao_channel_id: "", redes: {}, schedule: [], clips: [] } };
  }
}

// ─── LOGGER ───────────────────────────────────────────────
function log(tipo, msg) {
  const ts = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const prefixos = { info: "ℹ️", ok: "✅", warn: "⚠️", error: "❌" };
  console.log(`[${ts}] ${prefixos[tipo] || "•"} ${msg}`);
}
// ──────────────────────────────────────────────────────────

// ─── DATABASE COM CACHE ───────────────────────────────────
let _cache = null;
let _dirty = false;

function loadDB() {
  if (_cache) return _cache;
  try {
    if (!fs.existsSync(DB_FILE)) {
      _cache = {
        pontos: {},
        config: {
          twitch_username: "", notif_channel_id: "", sugestao_channel_id: "",
          redes: { twitch: "", tiktok: "", instagram: "", youtube: "", discord: "" },
          schedule: [
            { dia: "Segunda", horario: "Descanso 😴", jogo: "" },
            { dia: "Terça",   horario: "20:00",        jogo: "Variety" },
            { dia: "Quarta",  horario: "20:00",        jogo: "Variety" },
            { dia: "Quinta",  horario: "20:00",        jogo: "Variety" },
            { dia: "Sexta",   horario: "21:00",        jogo: "Live principal 🔴" },
            { dia: "Sábado",  horario: "18:00",        jogo: "Live principal 🔴" },
            { dia: "Domingo", horario: "Descanso 😴",  jogo: "" },
          ],
          clips: [],
        },
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(_cache, null, 2));
      log("ok", "data.json criado.");
      return _cache;
    }
    _cache = JSON.parse(fs.readFileSync(DB_FILE));
    log("ok", "data.json carregado.");
    return _cache;
  } catch (e) {
    log("error", `Erro ao ler data.json: ${e.message}`);
    _cache = { pontos: {}, config: { twitch_username: "", notif_channel_id: "", sugestao_channel_id: "", redes: {}, schedule: [], clips: [] } };
    return _cache;
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(_cache, null, 2));
    _dirty = false;
  } catch (e) {
    log("error", `Erro ao salvar data.json: ${e.message}`);
  }
}

function markDirty() { _dirty = true; }

// Auto-save a cada 5 minutos se houver mudanças
setInterval(() => {
  if (_dirty) {
    saveDB();
    log("info", "Auto-save do data.json.");
  }
}, 5 * 60 * 1000);

// Backup diário
setInterval(() => {
  try {
    fs.copyFileSync(DB_FILE, "./data.backup.json");
    log("info", "Backup diário criado.");
  } catch (e) {
    log("warn", `Falha no backup: ${e.message}`);
  }
}, 24 * 60 * 60 * 1000);

function getCfg() {
  const db = loadDB();
  return db.config || { twitch_username: "", notif_channel_id: "", sugestao_channel_id: "", logs_channel_id: "", redes: {}, schedule: [], clips: [] };
}

function saveCfg(cfg) { loadDB().config = cfg; markDirty(); saveDB(); }
function getPontos(id)      { return loadDB().pontos[id] || 0; }
function addPontos(id, qtd) {
  const db = loadDB();
  db.pontos[id] = (db.pontos[id] || 0) + qtd;
  markDirty();
  saveDB();
  return db.pontos[id];
}
// ──────────────────────────────────────────────────────────

// ─── COOLDOWNS ────────────────────────────────────────────
const cooldowns = new Map();
const COOLDOWN_CMDS = {
  trivia:    30,
  roleta:    15,
  slot:      15,
  blackjack: 10,
  roast:     30,
  gpt:       10,
  duel:      20,
  crime:     3600, // 1 hora
  missao:    86400, // 24 horas
  transferir: 30,
};

function checkCooldown(userId, cmd) {
  const key   = `${userId}:${cmd}`;
  const agora = Date.now();
  const fim   = cooldowns.get(key) || 0;
  if (agora < fim) return Math.ceil((fim - agora) / 1000);
  cooldowns.set(key, agora + (COOLDOWN_CMDS[cmd] || 0) * 1000);
  return 0;
}
// ──────────────────────────────────────────────────────────

// ─── SISTEMA DE LOGS ──────────────────────────────────────
async function sendLog(guild, tipo, descricao, campos = []) {
  const cfg = getCfg();
  if (!cfg.logs_channel_id) return;
  const canal = guild?.channels?.cache?.get(cfg.logs_channel_id);
  if (!canal) return;

  const cores = {
    economia:  0x2ecc71,
    crime:     0xe74c3c,
    duelo:     0xe67e22,
    loja:      0x9b59b6,
    admin:     0x3498db,
    giveaway:  0xe91e63,
    missao:    0xf1c40f,
  };

  const emojis = {
    economia: "💰", crime: "🦹", duelo: "⚔️",
    loja: "🛒", admin: "🔧", giveaway: "🎉", missao: "📜",
  };

  const embed = new EmbedBuilder()
    .setColor(cores[tipo] || 0x95a5a6)
    .setTitle(`${emojis[tipo] || "📋"} Log — ${tipo.charAt(0).toUpperCase() + tipo.slice(1)}`)
    .setDescription(descricao)
    .setTimestamp();

  if (campos.length) embed.addFields(campos);
  canal.send({ embeds: [embed] }).catch(() => {});
}
// ──────────────────────────────────────────────────────────

// ─── HELPERS DE LOJA ──────────────────────────────────────
function getLoja() {
  return loadDB().loja || [];
}

function getInventario(userId) {
  return (loadDB().inventarios || {})[userId] || [];
}

function addInventario(userId, item) {
  const db = loadDB();
  if (!db.inventarios) db.inventarios = {};
  if (!db.inventarios[userId]) db.inventarios[userId] = [];
  db.inventarios[userId].push({ nome: item.nome, compradoEm: Date.now() });
  markDirty(); saveDB();
}
// ──────────────────────────────────────────────────────────

// ─── MEMÓRIA DA IA ────────────────────────────────────────
const MAX_HISTORICO = 10;

function getHistorico(userId) {
  const db = loadDB();
  return (db.ia_historico || {})[userId] || [];
}

function salvarHistorico(userId, historico) {
  const db = loadDB();
  if (!db.ia_historico) db.ia_historico = {};
  if (historico.length > MAX_HISTORICO * 2) historico = historico.slice(-MAX_HISTORICO * 2);
  db.ia_historico[userId] = historico;
  markDirty();
  saveDB();
}

function limparHistorico(userId) {
  const db = loadDB();
  if (!db.ia_historico) return;
  if (userId) delete db.ia_historico[userId];
  else db.ia_historico = {};
  markDirty();
  saveDB();
}

function getInstrucoes() {
  return loadDB().ia_instrucoes || "Você é um assistente útil e direto num servidor de Discord. Responda sempre em português do Brasil. Seja conciso mas completo.";
}

function salvarInstrucoes(texto) {
  loadDB().ia_instrucoes = texto;
  markDirty();
  saveDB();
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
  new SlashCommandBuilder().setName("ping").setDescription("Mostra a latência do bot"),
  new SlashCommandBuilder().setName("redes").setDescription("Mostra todas as redes sociais"),
  new SlashCommandBuilder().setName("schedule").setDescription("Agenda de lives"),
  new SlashCommandBuilder().setName("clip").setDescription("Clip aleatório"),
  new SlashCommandBuilder().setName("rank").setDescription("Vê os teus pontos"),
  new SlashCommandBuilder().setName("top").setDescription("Top 10 do ranking"),

  new SlashCommandBuilder()
    .setName("perfil").setDescription("Mostra o teu perfil completo")
    .addUserOption(o => o.setName("usuario").setDescription("Ver perfil de outro usuário").setRequired(false)),

  new SlashCommandBuilder()
    .setName("duel").setDescription("Desafia alguém para um duelo")
    .addUserOption(o => o.setName("usuario").setDescription("Quem queres duelar").setRequired(true))
    .addIntegerOption(o => o.setName("aposta").setDescription("Pontos apostados").setMinValue(1)),

  new SlashCommandBuilder()
    .setName("giveaway").setDescription("Inicia um sorteio (apenas dono)")
    .addStringOption(o => o.setName("premio").setDescription("O que vai ser sorteado").setRequired(true)),

  new SlashCommandBuilder()
    .setName("poll").setDescription("Cria uma votação")
    .addStringOption(o => o.setName("pergunta").setDescription("A pergunta").setRequired(true))
    .addStringOption(o => o.setName("opcao1").setDescription("Opção 1").setRequired(true))
    .addStringOption(o => o.setName("opcao2").setDescription("Opção 2").setRequired(true))
    .addStringOption(o => o.setName("opcao3").setDescription("Opção 3"))
    .addStringOption(o => o.setName("opcao4").setDescription("Opção 4"))
    .addStringOption(o => o.setName("opcao5").setDescription("Opção 5")),

  new SlashCommandBuilder().setName("trivia").setDescription("Responde e ganha pontos"),

  new SlashCommandBuilder()
    .setName("roleta").setDescription("Aposta pontos — dobra ou perde!")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("sugestao").setDescription("Envia uma sugestão para o streamer")
    .addStringOption(o => o.setName("texto").setDescription("Tua sugestão").setRequired(true)),

  new SlashCommandBuilder()
    .setName("hype").setDescription("🔴 Manda um embed de hype para a galera entrar na live!")
    .addStringOption(o => o.setName("jogo").setDescription("Jogo ou conteúdo da live (opcional)")),

  new SlashCommandBuilder()
    .setName("gpt").setDescription("🤖 Faz uma pergunta para a IA (Groq)")
    .addStringOption(o => o.setName("pergunta").setDescription("O que queres perguntar?").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ia_config").setDescription("⚙️ Configura a IA (apenas dono)")
    .addSubcommand(s => s
      .setName("instrucoes").setDescription("Define as instruções base da IA")
      .addStringOption(o => o.setName("texto").setDescription("Instruções do sistema").setRequired(true)))
    .addSubcommand(s => s
      .setName("ver").setDescription("Mostra as instruções atuais"))
    .addSubcommand(s => s
      .setName("limpar_memoria").setDescription("Limpa o histórico de conversa de um usuário")
      .addUserOption(o => o.setName("usuario").setDescription("Usuário (vazio = todos)").setRequired(false))),

  new SlashCommandBuilder()
    .setName("slot").setDescription("🎰 Gira a slot machine e tenta a sorte!")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade de pontos").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("blackjack").setDescription("🃏 Joga 21 contra o bot")
    .addIntegerOption(o => o.setName("aposta").setDescription("Quantidade de pontos").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName("diario").setDescription("💰 Pega tua recompensa diária de pontos"),

  new SlashCommandBuilder()
    .setName("transferir").setDescription("💸 Transfere pontos para alguém")
    .addUserOption(o => o.setName("usuario").setDescription("Quem vai receber").setRequired(true))
    .addIntegerOption(o => o.setName("quantidade").setDescription("Quantos pontos").setRequired(true).setMinValue(1)),

  new SlashCommandBuilder()
    .setName("crime").setDescription("🦹 Tenta cometer um crime (cooldown 1h)")
    .addStringOption(o => o.setName("alvo").setDescription("Alvo do crime (opcional)").setRequired(false)),

  new SlashCommandBuilder().setName("missao").setDescription("📜 Pega uma missão diária gerada pela IA"),

  new SlashCommandBuilder().setName("loja").setDescription("🛒 Vê os itens disponíveis na loja"),

  new SlashCommandBuilder()
    .setName("comprar").setDescription("🛍️ Compra um item da loja")
    .addStringOption(o => o.setName("item").setDescription("Nome do item").setRequired(true)),

  new SlashCommandBuilder().setName("inventario").setDescription("🎒 Vê teu inventário"),

  new SlashCommandBuilder()
    .setName("roast").setDescription("🔥 Pede pro Grok detonar alguém")
    .addUserOption(o => o.setName("usuario").setDescription("Quem vai ser detona").setRequired(true)),

  new SlashCommandBuilder().setName("comandos").setDescription("📋 Lista todos os comandos do bot"),

  new SlashCommandBuilder()
    .setName("gado").setDescription("Descobre o quanto alguém é gado 🐄")
    .addUserOption(o => o.setName("usuario").setDescription("Quem queres testar").setRequired(false)),

  new SlashCommandBuilder()
    .setName("beijar").setDescription("Beija alguém 💋")
    .addUserOption(o => o.setName("usuario").setDescription("Quem queres beijar").setRequired(true)),

  new SlashCommandBuilder()
    .setName("abracar").setDescription("Abraça alguém 🤗")
    .addUserOption(o => o.setName("usuario").setDescription("Quem queres abraçar").setRequired(true)),

  new SlashCommandBuilder()
    .setName("tapa").setDescription("Dá um tapa em alguém 👋")
    .addUserOption(o => o.setName("usuario").setDescription("Quem vai levar o tapa").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ship").setDescription("Testa a compatibilidade entre duas pessoas 💘")
    .addUserOption(o => o.setName("usuario1").setDescription("Primeira pessoa").setRequired(true))
    .addUserOption(o => o.setName("usuario2").setDescription("Segunda pessoa (deixa vazio para te incluir)").setRequired(false)),

  // CONFIG
  new SlashCommandBuilder()
    .setName("config").setDescription("Configura o bot (apenas dono)")
    .addSubcommand(s => s.setName("ver").setDescription("Mostra a config atual"))
    .addSubcommand(s => s
      .setName("twitch").setDescription("Define o username da Twitch")
      .addStringOption(o => o.setName("username").setDescription("Username da Twitch").setRequired(true)))
    .addSubcommand(s => s
      .setName("canal_notif").setDescription("Canal de notificações de live")
      .addChannelOption(o => o.setName("canal").setDescription("Canal").setRequired(true)))
    .addSubcommand(s => s
      .setName("canal_sugestao").setDescription("Canal de sugestões")
      .addChannelOption(o => o.setName("canal").setDescription("Canal").setRequired(true)))
    .addSubcommand(s => s
      .setName("rede").setDescription("Atualiza uma rede social")
      .addStringOption(o => o.setName("nome").setDescription("Nome da rede").setRequired(true)
        .addChoices(
          { name: "Twitch",    value: "twitch" },
          { name: "TikTok",    value: "tiktok" },
          { name: "Instagram", value: "instagram" },
          { name: "YouTube",   value: "youtube" },
          { name: "Discord",   value: "discord" },
        ))
      .addStringOption(o => o.setName("url").setDescription("URL da rede").setRequired(true)))
    .addSubcommand(s => s
      .setName("schedule").setDescription("Edita um dia da agenda")
      .addStringOption(o => o.setName("dia").setDescription("Dia da semana").setRequired(true)
        .addChoices(
          { name: "Segunda", value: "Segunda" },
          { name: "Terça",   value: "Terça" },
          { name: "Quarta",  value: "Quarta" },
          { name: "Quinta",  value: "Quinta" },
          { name: "Sexta",   value: "Sexta" },
          { name: "Sábado",  value: "Sábado" },
          { name: "Domingo", value: "Domingo" },
        ))
      .addStringOption(o => o.setName("horario").setDescription("Horário (ex: 20:00) ou 'Descanso'").setRequired(true))
      .addStringOption(o => o.setName("jogo").setDescription("Jogo ou tipo de conteúdo")))
    .addSubcommand(s => s
      .setName("clip_add").setDescription("Adiciona um clip")
      .addStringOption(o => o.setName("nome").setDescription("Nome do clip").setRequired(true))
      .addStringOption(o => o.setName("url").setDescription("URL do clip").setRequired(true)))
    .addSubcommand(s => s
      .setName("clip_remove").setDescription("Remove um clip pelo nome")
      .addStringOption(o => o.setName("nome").setDescription("Nome do clip").setRequired(true)))
    .addSubcommand(s => s
      .setName("canal_logs").setDescription("Canal de logs de ações")
      .addChannelOption(o => o.setName("canal").setDescription("Canal").setRequired(true))),

  // OWNER
  new SlashCommandBuilder()
    .setName("owner").setDescription("Comandos do dono")
    .addSubcommand(s => s.setName("say").setDescription("Bot fala num canal")
      .addChannelOption(o => o.setName("canal").setDescription("Canal").setRequired(true))
      .addStringOption(o => o.setName("mensagem").setDescription("Mensagem").setRequired(true)))
    .addSubcommand(s => s.setName("embed").setDescription("Manda embed num canal")
      .addChannelOption(o => o.setName("canal").setDescription("Canal").setRequired(true))
      .addStringOption(o => o.setName("titulo").setDescription("Título").setRequired(true))
      .addStringOption(o => o.setName("descricao").setDescription("Descrição")))
    .addSubcommand(s => s.setName("status").setDescription("Muda o status do bot")
      .addStringOption(o => o.setName("texto").setDescription("Novo status").setRequired(true)))
    .addSubcommand(s => s.setName("darpontos").setDescription("Dá pontos a alguém")
      .addUserOption(o => o.setName("usuario").setDescription("Usuário").setRequired(true))
      .addIntegerOption(o => o.setName("quantidade").setDescription("Quantidade").setRequired(true)))
    .addSubcommand(s => s.setName("loja_add").setDescription("Adiciona item à loja")
      .addStringOption(o => o.setName("nome").setDescription("Nome do item").setRequired(true))
      .addIntegerOption(o => o.setName("preco").setDescription("Preço em pontos").setRequired(true))
      .addStringOption(o => o.setName("descricao").setDescription("Descrição do item").setRequired(true))
      .addStringOption(o => o.setName("cargo_id").setDescription("ID do cargo a dar (opcional)").setRequired(false)))
    .addSubcommand(s => s.setName("loja_remove").setDescription("Remove item da loja")
      .addStringOption(o => o.setName("nome").setDescription("Nome do item").setRequired(true))),

].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
(async () => {
  try {
    console.log("⏳ Registando slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash commands registados!");
  } catch (e) {
    console.error("Erro ao registar commands:", e);
  }
})();

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
  const cfg = getCfg();
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${cfg.twitch_client_id}&client_secret=${cfg.twitch_client_secret}&grant_type=client_credentials`,
    { method: "POST" }
  );
  const data = await res.json();
  twitchToken = data.access_token;
}

async function checkTwitch() {
  try {
    const cfg = getCfg();
    if (!cfg.twitch_username || !cfg.twitch_client_id || !cfg.twitch_client_secret) return;
    if (!twitchToken) await getTwitchToken();
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_login=${cfg.twitch_username}`,
      { headers: { "Client-ID": cfg.twitch_client_id, Authorization: `Bearer ${twitchToken}` } }
    );
    const data   = await res.json();
    const stream = data.data?.[0];

    if (stream && !streamOnline) {
      streamOnline = true;
      const canal = client.channels.cache.get(cfg.notif_channel_id);
      if (!canal) return;
      const embed = new EmbedBuilder()
        .setColor(0x9146ff)
        .setTitle(`🔴 ${cfg.twitch_username} está AO VIVO!`)
        .setDescription(`**${stream.title}**`)
        .addFields(
          { name: "🎮 Jogo",    value: stream.game_name || "Não informado", inline: true },
          { name: "👥 Viewers", value: `${stream.viewer_count}`,            inline: true }
        )
        .setURL(cfg.redes.twitch || `https://twitch.tv/${cfg.twitch_username}`)
        .setThumbnail(`https://static-cdn.jtvnw.net/previews-ttv/live_user_${cfg.twitch_username}-320x180.jpg?r=${Date.now()}`)
        .setTimestamp()
        .setFooter({ text: "Twitch Live" });
      canal.send({ content: "@everyone 🔴 A live começou!", embeds: [embed] });
    } else if (!stream && streamOnline) {
      streamOnline = false;
    }
  } catch (e) {
    console.error("Erro Twitch:", e.message);
  }
}

client.once("ready", async () => {
  log("ok", `Online como ${client.user.tag}`);
  try {
    const cfg = getCfg();
    client.user.setActivity(cfg.twitch_username ? `twitch.tv/${cfg.twitch_username} 🔴` : "Configurando... /config", { type: 1 });
  } catch (e) {
    log("error", `Erro ao carregar config: ${e.message}`);
    client.user.setActivity("Configurando... /config", { type: 1 });
  }
  setInterval(checkTwitch, 60_000);
  checkTwitch();
});

// ─── INTERACTIONS ─────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
  const { commandName } = interaction;

  // Cooldown check
  if (COOLDOWN_CMDS[commandName]) {
    const restante = checkCooldown(interaction.user.id, commandName);
    if (restante > 0) {
      return interaction.reply({ content: `⏳ Aguarda **${restante}s** antes de usar \`/${commandName}\` de novo.`, ephemeral: true });
    }
  }

  // PING
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
      )
      .setTimestamp();
    await interaction.editReply({ content: "", embeds: [embed] });
  }

  // REDES
  if (commandName === "redes") {
    const cfg = getCfg();
    const r   = cfg.redes;
    const linhas = [
      r.twitch    ? `🟣 **Twitch:** ${r.twitch}`       : null,
      r.tiktok    ? `🎵 **TikTok:** ${r.tiktok}`       : null,
      r.instagram ? `📸 **Instagram:** ${r.instagram}` : null,
      r.youtube   ? `▶️ **YouTube:** ${r.youtube}`     : null,
      r.discord   ? `💬 **Discord:** ${r.discord}`     : null,
    ].filter(Boolean);

    if (linhas.length === 0)
      return interaction.reply({ content: "❌ Nenhuma rede configurada ainda. Use `/config rede`.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("📱 Redes Sociais")
      .setDescription(linhas.join("\n"))
      .setFooter({ text: "Segue e apoia o canal! 🔥" });
    await interaction.reply({ embeds: [embed] });
  }

  // SCHEDULE
  if (commandName === "schedule") {
    const cfg    = getCfg();
    const linhas = cfg.schedule.map(s =>
      s.horario === "Descanso 😴" || s.horario === "Descanso"
        ? `**${s.dia}** — Descanso 😴`
        : `**${s.dia}** — \`${s.horario}\`${s.jogo ? ` — ${s.jogo}` : ""}`
    ).join("\n");
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📅 Agenda de Lives")
      .setDescription(linhas)
      .setFooter({ text: "Horário de Brasília • Sujeito a alterações" });
    await interaction.reply({ embeds: [embed] });
  }

  // CLIP
  if (commandName === "clip") {
    const cfg   = getCfg();
    const clips = cfg.clips;
    if (!clips || clips.length === 0)
      return interaction.reply({ content: "❌ Nenhum clip configurado ainda. Use `/config clip_add`.", ephemeral: true });
    const clip  = clips[Math.floor(Math.random() * clips.length)];
    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("🎬 Clip em destaque")
      .setDescription(`**${clip.nome}**\n${clip.url}`)
      .setFooter({ text: "Salva o clip! 👀" });
    await interaction.reply({ embeds: [embed] });
  }

  // RANK
  if (commandName === "rank") {
    const pts = getPontos(interaction.user.id);
    const db  = loadDB();
    const pos = Object.entries(db.pontos).sort((a, b) => b[1] - a[1]).findIndex(([id]) => id === interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🏆 Teus Pontos")
      .setDescription(`**${interaction.user.username}** tem **${pts}** pontos\nPosição: **#${pos + 1}**`)
      .setThumbnail(interaction.user.displayAvatarURL());
    await interaction.reply({ embeds: [embed] });
  }

  // TOP
  if (commandName === "top") {
    await interaction.deferReply();
    const db  = loadDB();
    const top = Object.entries(db.pontos).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const linhas = await Promise.all(top.map(async ([id, pts], i) => {
      const u = await client.users.fetch(id).catch(() => ({ username: "Desconhecido" }));
      const m = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      return `${m} **${u.username}** — ${pts} pts`;
    }));
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🏆 Top 10 — Ranking")
      .setDescription(linhas.join("\n") || "Ainda sem pontos.");
    await interaction.editReply({ embeds: [embed] });
  }

  // PERFIL
  if (commandName === "perfil") {
    const alvo   = interaction.options.getUser("usuario") || interaction.user;
    const db     = loadDB();
    const userId = alvo.id;

    const pts    = db.pontos[userId] || 0;
    const stats  = db.stats?.[userId] || { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0, roubos: 0 };
    const diario = db.diario?.[userId] || 0;

    // Posição no ranking
    const ranking = Object.entries(db.pontos).sort((a, b) => b[1] - a[1]);
    const pos     = ranking.findIndex(([id]) => id === userId) + 1;
    const total   = ranking.length;

    // Nível baseado em pontos
    const nivel   = Math.floor(Math.sqrt(pts / 50));
    const proxLvl = Math.pow(nivel + 1, 2) * 50;
    const progresso = Math.min(Math.floor((pts / proxLvl) * 10), 10);
    const barra   = "█".repeat(progresso) + "░".repeat(10 - progresso);

    // Último diário
    const ultimoDiario = diario
      ? `<t:${Math.floor(diario / 1000)}:R>`
      : "Nunca";

    // Medalha de ranking
    const medalha = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : `#${pos}`;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: `Perfil de ${alvo.username}`, iconURL: alvo.displayAvatarURL() })
      .setThumbnail(alvo.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: "📊 Geral",
          value:
            `💰 **Pontos:** ${pts}\n` +
            `🏆 **Ranking:** ${medalha} de ${total}\n` +
            `⭐ **Nível:** ${nivel}\n` +
            `\`[${barra}]\` ${pts}/${proxLvl} pts`,
          inline: false,
        },
        {
          name: "⚔️ Duelos",
          value:
            `✅ Ganhos: **${stats.duelos_ganhos}**\n` +
            `❌ Perdidos: **${stats.duelos_perdidos}**\n` +
            `📈 Win rate: **${stats.duelos_ganhos + stats.duelos_perdidos > 0 ? Math.round((stats.duelos_ganhos / (stats.duelos_ganhos + stats.duelos_perdidos)) * 100) : 0}%**`,
          inline: true,
        },
        {
          name: "🎰 Cassino",
          value:
            `🎰 Slots: **${stats.slots_jogados}**\n` +
            `🃏 Blackjack: **${stats.bj_jogados}**\n` +
            `🧠 Trivias: **${stats.trivia_acertos}**`,
          inline: true,
        },
        {
          name: "📅 Diário",
          value: `Último: ${ultimoDiario}`,
          inline: false,
        },
      )
      .setFooter({ text: `ID: ${userId}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }


  if (commandName === "duel") {
    const alvo  = interaction.options.getUser("usuario");
    const aposta = interaction.options.getInteger("aposta") || 50;
    if (alvo.bot || alvo.id === interaction.user.id)
      return interaction.reply({ content: "❌ Alvo inválido.", ephemeral: true });
    if (getPontos(interaction.user.id) < aposta)
      return interaction.reply({ content: `❌ Tens menos de ${aposta} pontos.`, ephemeral: true });
    if (getPontos(alvo.id) < aposta)
      return interaction.reply({ content: `❌ ${alvo.username} não tem pontos suficientes.`, ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("duel_aceitar").setLabel("✅ Aceitar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("duel_recusar").setLabel("❌ Recusar").setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({
      content: `⚔️ ${alvo} foi desafiado por ${interaction.user}!\nAposta: **${aposta} pontos** — 30s para aceitar.`,
      components: [row],
    });
    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30_000,
      filter: i => i.user.id === alvo.id,
    });
    collector.on("collect", async i => {
      if (i.customId === "duel_recusar") {
        await i.update({ content: `❌ ${alvo.username} recusou o duelo.`, components: [] });
        return collector.stop();
      }
      const vencedor = Math.random() < 0.5 ? interaction.user : alvo;
      const perdedor = vencedor.id === interaction.user.id ? alvo : interaction.user;
      addPontos(vencedor.id, aposta);
      addPontos(perdedor.id, -aposta);

      // Rastrear stats
      const db2 = loadDB();
      if (!db2.stats) db2.stats = {};
      if (!db2.stats[vencedor.id]) db2.stats[vencedor.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
      if (!db2.stats[perdedor.id]) db2.stats[perdedor.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
      db2.stats[vencedor.id].duelos_ganhos++;
      db2.stats[perdedor.id].duelos_perdidos++;
      markDirty(); saveDB();

      // Log duelo
      sendLog(interaction.guild, "duelo",
        `⚔️ **${vencedor.username}** venceu o duelo contra **${perdedor.username}**`,
        [{ name: "Aposta", value: `${aposta} pts`, inline: true }]
      );

      await i.update({
        content: `⚔️ **${vencedor.username}** venceu e ganhou **${aposta} pontos** de ${perdedor.username}!`,
        components: [],
      });
      collector.stop();
    });
    collector.on("end", (_, reason) => {
      if (reason === "time") interaction.editReply({ content: "⏰ Duelo expirou.", components: [] });
    });
  }

  // GIVEAWAY
  if (commandName === "giveaway") {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Apenas o dono pode iniciar sorteios.", ephemeral: true });
    const premio = interaction.options.getString("premio");
    const embed  = new EmbedBuilder()
      .setColor(0xe91e63)
      .setTitle("🎉 GIVEAWAY!")
      .setDescription(`**Prémio:** ${premio}\n\nReage com 🎉 para participar!\nSorteio em **60 segundos**.`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    await msg.react("🎉");
    setTimeout(async () => {
      const reactions     = await msg.reactions.cache.get("🎉")?.users.fetch();
      const participantes = reactions?.filter(u => !u.bot);
      if (!participantes || participantes.size === 0)
        return interaction.channel.send("😢 Ninguém participou.");
      const vencedor = participantes.random();
      interaction.channel.send(`🎉 Parabéns ${vencedor}! Ganhaste: **${premio}**`);
      vencedor.send(`🎉 Parabéns! Ganhaste o sorteio no servidor **${interaction.guild.name}**!\nPrémio: **${premio}**`).catch(() => {
        log("warn", `Não foi possível enviar DM para ${vencedor.username}`);
      });
      const vencedor = participantes.random();
      interaction.channel.send(`🎉 Parabéns ${vencedor}! Ganhaste: **${premio}**`);
      vencedor.send(`🎉 Parabéns! Ganhaste o sorteio no servidor **${interaction.guild.name}**!\nPrémio: **${premio}**`).catch(() => {
        log("warn", `Não foi possível enviar DM para ${vencedor.username}`);
      });
      sendLog(interaction.guild, "giveaway",
        `🎉 **${vencedor.username}** ganhou o sorteio iniciado por **${interaction.user.username}**`,
        [{ name: "Prémio", value: premio, inline: true }]
      );
    }, 60_000);
  }

  // TRANSFERIR
  if (commandName === "transferir") {
    const alvo = interaction.options.getUser("usuario");
    const qtd  = interaction.options.getInteger("quantidade");
    if (alvo.bot || alvo.id === interaction.user.id)
      return interaction.reply({ content: "❌ Alvo inválido.", ephemeral: true });
    if (getPontos(interaction.user.id) < qtd)
      return interaction.reply({ content: `❌ Não tens ${qtd} pontos suficientes.`, ephemeral: true });

    addPontos(interaction.user.id, -qtd);
    addPontos(alvo.id, qtd);

    sendLog(interaction.guild, "economia",
      `💸 **${interaction.user.username}** transferiu **${qtd} pts** para **${alvo.username}**`
    );

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("💸 Transferência realizada!")
      .setDescription(`**${interaction.user.username}** enviou **${qtd} pontos** para **${alvo.username}**`)
      .addFields(
        { name: "Teu saldo", value: `${getPontos(interaction.user.id)} pts`, inline: true },
        { name: `Saldo de ${alvo.username}`, value: `${getPontos(alvo.id)} pts`, inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  }

  // CRIME
  if (commandName === "crime") {
    const alvo = interaction.options.getString("alvo") || "uma vítima aleatória";
    await interaction.deferReply();

    try {
      const instrucoes = getInstrucoes();
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: instrucoes },
            { role: "user", content: `Gera um cenário curto e engraçado de crime que ${interaction.user.username} tentou cometer contra ${alvo}. Decide aleatoriamente se o crime foi bem sucedido ou não. Se sucesso, diz que ganhou entre 50 e 300 pontos. Se falhou, diz que perdeu entre 30 e 150 pontos e qual foi a consequência engraçada. Responde APENAS em JSON no formato: {"sucesso": true/false, "pontos": numero, "historia": "texto curto engraçado"}` }
          ],
          max_tokens: 256,
          temperature: 0.95,
        }),
      });

      const data    = await res.json();
      const texto   = data.choices?.[0]?.message?.content || "";
      const clean   = texto.replace(/```json|```/g, "").trim();
      const parsed  = JSON.parse(clean);

      const diff    = parsed.sucesso ? parsed.pontos : -parsed.pontos;
      const total   = addPontos(interaction.user.id, diff);

      sendLog(interaction.guild, "crime",
        `🦹 **${interaction.user.username}** cometeu um crime contra **${alvo}** — ${parsed.sucesso ? "✅ Sucesso" : "❌ Falhou"}`,
        [{ name: parsed.sucesso ? "Ganhou" : "Perdeu", value: `${parsed.pontos} pts`, inline: true }]
      );

      const embed = new EmbedBuilder()
        .setColor(parsed.sucesso ? 0x2ecc71 : 0xe74c3c)
        .setTitle(parsed.sucesso ? "🦹 Crime bem sucedido!" : "🚔 Foste apanhado!")
        .setDescription(parsed.historia)
        .addFields(
          { name: parsed.sucesso ? "💰 Ganhou" : "💸 Perdeu", value: `${parsed.pontos} pts`, inline: true },
          { name: "💳 Saldo", value: `${total} pts`, inline: true }
        )
        .setFooter({ text: "Cooldown: 1 hora" });

      await interaction.editReply({ embeds: [embed] });

    } catch (e) {
      log("error", `Erro crime: ${e.message}`);
      await interaction.editReply({ content: "❌ O crime falhou miseravelmente antes de começar." });
    }
  }

  // MISSÃO
  if (commandName === "missao") {
    const db     = loadDB();
    const userId = interaction.user.id;
    if (!db.missoes) db.missoes = {};

    const missaoAtual = db.missoes[userId];
    if (missaoAtual && !missaoAtual.concluida) {
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("📜 Tua missão atual")
        .setDescription(missaoAtual.descricao)
        .addFields({ name: "🏆 Recompensa", value: `${missaoAtual.recompensa} pts`, inline: true })
        .setFooter({ text: "Completa com /missao_concluir quando terminares" });
      return interaction.reply({ embeds: [embed] });
    }

    await interaction.deferReply();
    try {
      const instrucoes = getInstrucoes();
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: instrucoes },
            { role: "user", content: `Gera uma missão diária engraçada e simples para um membro de servidor Discord de streamer. Exemplos: "Manda uma mensagem no chat", "Reage a 3 mensagens", "Menciona alguém". Responde APENAS em JSON: {"descricao": "texto da missão", "recompensa": numero_entre_50_e_200}` }
          ],
          max_tokens: 150,
          temperature: 0.9,
        }),
      });

      const data   = await res.json();
      const texto  = data.choices?.[0]?.message?.content || "";
      const clean  = texto.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);

      db.missoes[userId] = { descricao: parsed.descricao, recompensa: parsed.recompensa, concluida: false, criadaEm: Date.now() };
      markDirty(); saveDB();

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("📜 Nova Missão!")
        .setDescription(parsed.descricao)
        .addFields({ name: "🏆 Recompensa", value: `${parsed.recompensa} pts`, inline: true })
        .setFooter({ text: "Usa /missao_concluir quando terminares" });

      await interaction.editReply({ embeds: [embed] });

    } catch (e) {
      log("error", `Erro missão: ${e.message}`);
      await interaction.editReply({ content: "❌ Não consegui gerar uma missão agora. Tenta de novo." });
    }
  }

  // LOJA
  if (commandName === "loja") {
    const itens = getLoja();
    if (itens.length === 0)
      return interaction.reply({ content: "🛒 A loja está vazia. O dono pode adicionar itens com `/owner loja_add`.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🛒 Loja")
      .setDescription(itens.map((it, i) =>
        `**${i + 1}. ${it.nome}** — 💰 ${it.preco} pts\n${it.descricao}${it.cargo_id ? " • 🎭 Cargo incluído" : ""}`
      ).join("\n\n"))
      .setFooter({ text: "Usa /comprar <nome> para adquirir" });

    return interaction.reply({ embeds: [embed] });
  }

  // COMPRAR
  if (commandName === "comprar") {
    const nome  = interaction.options.getString("item").toLowerCase();
    const itens = getLoja();
    const item  = itens.find(i => i.nome.toLowerCase() === nome);

    if (!item)
      return interaction.reply({ content: `❌ Item **${nome}** não encontrado na loja.`, ephemeral: true });

    if (getPontos(interaction.user.id) < item.preco)
      return interaction.reply({ content: `❌ Precisas de **${item.preco} pts** mas tens apenas **${getPontos(interaction.user.id)} pts**.`, ephemeral: true });

    // Verifica se já tem o item (para itens de cargo)
    const inv = getInventario(interaction.user.id);
    if (item.cargo_id && inv.find(i => i.nome === item.nome))
      return interaction.reply({ content: `❌ Já tens o item **${item.nome}**.`, ephemeral: true });

    addPontos(interaction.user.id, -item.preco);
    addInventario(interaction.user.id, item);

    // Dar cargo se configurado
    if (item.cargo_id) {
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (member) await member.roles.add(item.cargo_id).catch(() => {});
    }

    sendLog(interaction.guild, "loja",
      `🛒 **${interaction.user.username}** comprou **${item.nome}** por **${item.preco} pts**`
    );

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("✅ Compra realizada!")
      .setDescription(`Adquiriste **${item.nome}**!`)
      .addFields(
        { name: "💸 Pago", value: `${item.preco} pts`, inline: true },
        { name: "💳 Saldo", value: `${getPontos(interaction.user.id)} pts`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }

  // INVENTÁRIO
  if (commandName === "inventario") {
    const inv = getInventario(interaction.user.id);
    if (inv.length === 0)
      return interaction.reply({ content: "🎒 Teu inventário está vazio. Compra algo na `/loja`!", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🎒 Inventário de ${interaction.user.username}`)
      .setDescription(inv.map((it, i) =>
        `**${i + 1}. ${it.nome}** — comprado <t:${Math.floor(it.compradoEm / 1000)}:R>`
      ).join("\n"));

    return interaction.reply({ embeds: [embed] });
  }

  // POLL
  if (commandName === "poll") {
    const pergunta = interaction.options.getString("pergunta");
    const emojis   = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"];
    const opcoes   = [1,2,3,4,5].map(n => interaction.options.getString(`opcao${n}`)).filter(Boolean);
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`📊 ${pergunta}`)
      .setDescription(opcoes.map((o, i) => `${emojis[i]} ${o}`).join("\n"))
      .setFooter({ text: `Poll por ${interaction.user.username}` });
    await interaction.reply({ embeds: [embed] });
    const msg = await interaction.fetchReply();
    for (let i = 0; i < opcoes.length; i++) await msg.react(emojis[i]);
  }

  // TRIVIA
  if (commandName === "trivia") {
    const q      = TRIVIAS[Math.floor(Math.random() * TRIVIAS.length)];
    const premio = 30;
    const embed  = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle("🧠 Trivia!")
      .setDescription(`**${q.pergunta}**\nResponde no chat em 20s para ganhar **${premio} pontos**!`);
    await interaction.reply({ embeds: [embed] });
    const filter    = m => m.author.id === interaction.user.id && m.content.toLowerCase().trim() === q.resposta.toLowerCase();
    const collector = interaction.channel.createMessageCollector({ filter, time: 20_000, max: 1 });
    collector.on("collect", () => {
      const total = addPontos(interaction.user.id, premio);
      const db2 = loadDB();
      if (!db2.stats) db2.stats = {};
      if (!db2.stats[interaction.user.id]) db2.stats[interaction.user.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
      db2.stats[interaction.user.id].trivia_acertos++;
      markDirty(); saveDB();
      interaction.channel.send(`✅ Correto, ${interaction.user}! +${premio} pontos. Total: **${total}**`);
    });
    collector.on("end", collected => {
      if (collected.size === 0) interaction.channel.send(`❌ Tempo esgotado! Resposta: **${q.resposta}**`);
    });
  }

  // ROLETA
  if (commandName === "roleta") {
    const aposta = interaction.options.getInteger("aposta");
    if (getPontos(interaction.user.id) < aposta)
      return interaction.reply({ content: `❌ Não tens ${aposta} pontos.`, ephemeral: true });
    const ganhou = Math.random() < 0.5;
    const total  = addPontos(interaction.user.id, ganhou ? aposta : -aposta);
    const embed  = new EmbedBuilder()
      .setColor(ganhou ? 0x2ecc71 : 0xe74c3c)
      .setTitle(ganhou ? "🟢 Sorte Grande!" : "🔴 Má Sorte...")
      .setDescription(ganhou
        ? `Ganhaste **${aposta} pontos**! Total: **${total}**`
        : `Perdeste **${aposta} pontos**. Total: **${total}**`);
    await interaction.reply({ embeds: [embed] });
  }

  // SUGESTÃO
  if (commandName === "sugestao") {
    const cfg   = getCfg();
    const texto = interaction.options.getString("texto");
    const canal = client.channels.cache.get(cfg.sugestao_channel_id);
    if (!canal)
      return interaction.reply({ content: "❌ Canal de sugestões não configurado. Use `/config canal_sugestao`.", ephemeral: true });
    const embed = new EmbedBuilder()
      .setColor(0xf39c12)
      .setTitle("💡 Nova Sugestão")
      .setDescription(texto)
      .setFooter({ text: `Por ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() })
      .setTimestamp();
    const msg = await canal.send({ embeds: [embed] });
    await msg.react("👍");
    await msg.react("👎");
    await interaction.reply({ content: "✅ Sugestão enviada!", ephemeral: true });
  }

  // HYPE
  if (commandName === "hype") {
    const cfg  = getCfg();
    const jogo = interaction.options.getString("jogo");

    const frases = [
      "A live tá no ar e tá IRADA! 🔥",
      "Não fiques de fora, a live começou! 🚀",
      "Tá todo mundo lá, e tu? 👀",
      "A galera tá reunida, vem pra live! 🎮",
      "Live ao vivo e ao caos! Entra já! ⚡",
    ];
    const frase = frases[Math.floor(Math.random() * frases.length)];

    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle("🔴 LIVE AO VIVO AGORA!")
      .setDescription(
        `## ${frase}\n\n` +
        (jogo ? `🎮 **Jogando:** ${jogo}\n` : "") +
        (cfg.redes?.twitch ? `\n🟣 **Twitch:** ${cfg.redes.twitch}` : "") +
        (cfg.redes?.tiktok ? `\n🎵 **TikTok:** ${cfg.redes.tiktok}` : "") +
        `\n\n**Entra, senta e se diverte! 🎉**`
      )
      .setImage("https://media.tenor.com/Aj2TxDRqzCgAAAAM/hype-train-twitch.gif")
      .setTimestamp()
      .setFooter({ text: cfg.twitch_username ? `@${cfg.twitch_username}` : "Live ao vivo!" });

    await interaction.reply({ content: "@everyone 🔴 **LIVE NO AR!**", embeds: [embed] });
  }

  // GPT (GROQ) com memória
  if (commandName === "gpt") {
    const pergunta = interaction.options.getString("pergunta");
    await interaction.deferReply();

    try {
      const historico = getHistorico(interaction.user.id);
      const instrucoes = getInstrucoes();

      const messages = [
        { role: "system", content: instrucoes },
        ...historico,
        { role: "user", content: pergunta },
      ];

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages,
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Erro na API");

      const resposta = data.choices?.[0]?.message?.content || "Sem resposta.";

      // Salva no histórico
      historico.push({ role: "user", content: pergunta });
      historico.push({ role: "assistant", content: resposta });
      salvarHistorico(interaction.user.id, historico);

      const cortada = resposta.length > 4000 ? resposta.slice(0, 3997) + "..." : resposta;
      const pares   = historico.length / 2;

      const embed = new EmbedBuilder()
        .setColor(0x00bfff)
        .setAuthor({ name: `${interaction.user.username} perguntou:`, iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`**${pergunta}**\n\n${cortada}`)
        .setFooter({ text: `Groq • llama-3.3-70b-versatile • 🧠 ${pares}/${MAX_HISTORICO} mensagens em memória` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (e) {
      console.error("Erro Groq:", e.message);
      await interaction.editReply({ content: `❌ Erro ao contactar a IA: \`${e.message}\`` });
    }
  }

  // IA_CONFIG
  if (commandName === "ia_config") {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Apenas o dono pode usar este comando.", ephemeral: true });

    const sub = interaction.options.getSubcommand();

    if (sub === "instrucoes") {
      const texto = interaction.options.getString("texto");
      salvarInstrucoes(texto);
      return interaction.reply({ content: `✅ Instruções da IA atualizadas!\n\`\`\`${texto}\`\`\``, ephemeral: true });
    }

    if (sub === "ver") {
      const instrucoes = getInstrucoes();
      return interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0x00bfff)
          .setTitle("🤖 Instruções atuais da IA")
          .setDescription(`\`\`\`${instrucoes}\`\`\``)
        ],
        ephemeral: true,
      });
    }

    if (sub === "limpar_memoria") {
      const alvo = interaction.options.getUser("usuario");
      limparHistorico(alvo?.id || null);
      return interaction.reply({
        content: alvo ? `✅ Histórico de **${alvo.username}** limpo.` : "✅ Histórico de todos os usuários limpo.",
        ephemeral: true,
      });
    }
  }

  // SLOT MACHINE
  if (commandName === "slot") {
    const aposta = interaction.options.getInteger("aposta");
    if (getPontos(interaction.user.id) < aposta)
      return interaction.reply({ content: `❌ Não tens ${aposta} pontos.`, ephemeral: true });

    const simbolos = ["🍒", "🍋", "🍇", "⭐", "💎", "🔔", "7️⃣"];
    const pesos    = [35, 25, 20, 10, 5, 4, 1]; // % de chance de cada símbolo

    function girar() {
      const total = pesos.reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      for (let i = 0; i < simbolos.length; i++) {
        r -= pesos[i];
        if (r <= 0) return simbolos[i];
      }
      return simbolos[0];
    }

    const rolos = [girar(), girar(), girar()];
    const [a, b, c] = rolos;

    let multiplicador = 0;
    let resultado = "";

    if (a === b && b === c) {
      if (a === "7️⃣")       { multiplicador = 10; resultado = "🏆 JACKPOT! TRÊS 7s!"; }
      else if (a === "💎")   { multiplicador = 7;  resultado = "💎 TRÊS DIAMANTES!"; }
      else if (a === "⭐")   { multiplicador = 5;  resultado = "⭐ TRÊS ESTRELAS!"; }
      else if (a === "🔔")   { multiplicador = 4;  resultado = "🔔 TRÊS SINOS!"; }
      else if (a === "🍇")   { multiplicador = 3;  resultado = "🍇 TRÊS UVAS!"; }
      else if (a === "🍋")   { multiplicador = 2;  resultado = "🍋 TRÊS LIMÕES!"; }
      else                   { multiplicador = 2;  resultado = "🍒 TRÊS CEREJAS!"; }
    } else if (a === b || b === c || a === c) {
      multiplicador = 1.5;
      resultado = "✨ Par! Recuperaste a aposta e um pouco mais!";
    } else {
      multiplicador = 0;
      resultado = "😢 Sem sorte dessa vez...";
    }

    const ganho = Math.floor(aposta * multiplicador);
    const diff  = ganho - aposta;
    const total = addPontos(interaction.user.id, diff);

    const db2 = loadDB();
    if (!db2.stats) db2.stats = {};
    if (!db2.stats[interaction.user.id]) db2.stats[interaction.user.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
    db2.stats[interaction.user.id].slots_jogados++;
    markDirty(); saveDB();

    const cor =
      multiplicador >= 5 ? 0xffd700 :
      multiplicador >= 2 ? 0x2ecc71 :
      multiplicador > 0  ? 0x3498db :
                           0xe74c3c;

    const embed = new EmbedBuilder()
      .setColor(cor)
      .setTitle("🎰 Slot Machine")
      .setDescription(
        `╔══════════════╗\n` +
        `║  ${a}  ${b}  ${c}  ║\n` +
        `╚══════════════╝\n\n` +
        `${resultado}\n\n` +
        (diff > 0
          ? `+**${diff}** pontos ganhos!`
          : diff < 0
          ? `-**${Math.abs(diff)}** pontos perdidos.`
          : `Aposta devolvida.`) +
        `\nSaldo: **${total}** pontos`
      )
      .setFooter({ text: `Aposta: ${aposta} pts • Multiplicador: x${multiplicador}` });

    return interaction.reply({ embeds: [embed] });
  }

  // BLACKJACK
  if (commandName === "blackjack") {
    const aposta = interaction.options.getInteger("aposta");
    if (getPontos(interaction.user.id) < aposta)
      return interaction.reply({ content: `❌ Não tens ${aposta} pontos.`, ephemeral: true });

    const naipes  = ["♠️","♥️","♦️","♣️"];
    const valores = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

    function novaDeck() {
      const deck = [];
      for (const n of naipes) for (const v of valores) deck.push({ v, n });
      return deck.sort(() => Math.random() - 0.5);
    }

    function valorCarta(v) {
      if (["J","Q","K"].includes(v)) return 10;
      if (v === "A") return 11;
      return parseInt(v);
    }

    function somaMAo(mao) {
      let total = mao.reduce((s, c) => s + valorCarta(c.v), 0);
      let ases  = mao.filter(c => c.v === "A").length;
      while (total > 21 && ases > 0) { total -= 10; ases--; }
      return total;
    }

    function mostrarMao(mao) {
      return mao.map(c => `\`${c.v}${c.n}\``).join(" ");
    }

    const deck     = novaDeck();
    const jogador  = [deck.pop(), deck.pop()];
    const dealer   = [deck.pop(), deck.pop()];

    const sessoes  = new Map();
    const sessionId = interaction.user.id;

    sessoes.set(sessionId, { deck, jogador, dealer, aposta, ended: false });

    function buildEmbed(jMao, dMao, status, hideDealer = true) {
      const jTotal = somaMAo(jMao);
      const dTotal = hideDealer ? "?" : somaMAo(dMao);
      return new EmbedBuilder()
        .setColor(status === "jogando" ? 0x2ecc71 : status === "ganhou" ? 0xffd700 : status === "empate" ? 0x3498db : 0xe74c3c)
        .setTitle("🃏 Blackjack")
        .addFields(
          { name: `Dealer ${hideDealer ? "" : `(${dTotal})`}`, value: hideDealer ? `\`${dMao[0].v}${dMao[0].n}\` \`🂠\`` : mostrarMao(dMao) },
          { name: `Tua mão (${jTotal})`, value: mostrarMao(jMao) },
        )
        .setFooter({ text: `Aposta: ${aposta} pts` });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bj_hit").setLabel("🃏 Pedir").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("bj_stand").setLabel("✋ Parar").setStyle(ButtonStyle.Danger),
    );

    const jTotal = somaMAo(jogador);

    // Blackjack natural
    if (jTotal === 21) {
      const ganho = Math.floor(aposta * 1.5);
      addPontos(interaction.user.id, ganho);
      const db2 = loadDB();
      if (!db2.stats) db2.stats = {};
      if (!db2.stats[interaction.user.id]) db2.stats[interaction.user.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
      db2.stats[interaction.user.id].bj_jogados++;
      markDirty(); saveDB();
      const embed = buildEmbed(jogador, dealer, "ganhou", false)
        .setDescription(`🎉 **BLACKJACK!** Ganhas **${ganho}** pontos!`);
      return interaction.reply({ embeds: [embed] });
    }

    await interaction.reply({
      embeds: [buildEmbed(jogador, dealer, "jogando")],
      components: [row],
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60_000,
      filter: i => i.user.id === interaction.user.id,
    });

    const state = sessoes.get(sessionId);

    collector.on("collect", async i => {
      if (state.ended) return;

      if (i.customId === "bj_hit") {
        state.jogador.push(state.deck.pop());
        const total = somaMAo(state.jogador);

        if (total > 21) {
          state.ended = true;
          addPontos(interaction.user.id, -aposta);
          const embed = buildEmbed(state.jogador, state.dealer, "perdeu", false)
            .setDescription(`💥 **Estourou!** (${total}) Perdeste **${aposta}** pontos.`);
          await i.update({ embeds: [embed], components: [] });
          return collector.stop();
        }
        if (total === 21) {
          i.customId = "bj_stand"; // força parar em 21
        } else {
          await i.update({ embeds: [buildEmbed(state.jogador, state.dealer, "jogando")], components: [row] });
          return;
        }
      }

      if (i.customId === "bj_stand") {
        state.ended = true;
        while (somaMAo(state.dealer) < 17) state.dealer.push(state.deck.pop());

        const jT = somaMAo(state.jogador);
        const dT = somaMAo(state.dealer);

        // Rastrear stat
        const db2 = loadDB();
        if (!db2.stats) db2.stats = {};
        if (!db2.stats[interaction.user.id]) db2.stats[interaction.user.id] = { duelos_ganhos: 0, duelos_perdidos: 0, trivia_acertos: 0, slots_jogados: 0, bj_jogados: 0 };
        db2.stats[interaction.user.id].bj_jogados++;
        markDirty(); saveDB();

        let status, desc;
        if (dT > 21 || jT > dT) {
          addPontos(interaction.user.id, aposta);
          status = "ganhou";
          desc   = `🏆 **Ganhaste!** (${jT} vs ${dT}) +**${aposta}** pontos!`;
        } else if (jT === dT) {
          status = "empate";
          desc   = `🤝 **Empate!** (${jT} vs ${dT}) Aposta devolvida.`;
        } else {
          addPontos(interaction.user.id, -aposta);
          status = "perdeu";
          desc   = `😔 **Perdeste!** (${jT} vs ${dT}) -**${aposta}** pontos.`;
        }

        const embed = buildEmbed(state.jogador, state.dealer, status, false).setDescription(desc);
        await i.update({ embeds: [embed], components: [] });
        collector.stop();
      }
    });

    collector.on("end", (_, reason) => {
      if (reason === "time" && !state.ended) {
        state.ended = true;
        addPontos(interaction.user.id, -aposta);
        interaction.editReply({ content: "⏰ Tempo esgotado! Perdeste a aposta.", components: [] });
      }
    });
  }

  // DIÁRIO
  if (commandName === "diario") {
    const db     = loadDB();
    const agora  = Date.now();
    const userId = interaction.user.id;

    if (!db.diario) db.diario = {};

    const ultimo = db.diario[userId] || 0;
    const diff   = agora - ultimo;
    const cooldown = 24 * 60 * 60 * 1000;

    if (diff < cooldown) {
      const restante = cooldown - diff;
      const h = Math.floor(restante / 3600000);
      const m = Math.floor((restante % 3600000) / 60000);
      return interaction.reply({
        content: `⏰ Já pegaste tua recompensa hoje. Volta em **${h}h ${m}m**.`,
        ephemeral: true,
      });
    }

    const premio = Math.floor(Math.random() * 150) + 50; // 50 a 200 pts
    db.diario[userId] = agora;
    db.pontos[userId] = (db.pontos[userId] || 0) + premio;
    markDirty(); saveDB();

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("💰 Recompensa Diária!")
      .setDescription(`**${interaction.user.username}** pegou **+${premio} pontos**!\nSaldo: **${db.pontos[userId]}** pontos`)
      .setFooter({ text: "Volta amanhã pra pegar mais" })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ROAST
  if (commandName === "roast") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === client.user.id)
      return interaction.reply({ content: "Nice try.", ephemeral: true });

    await interaction.deferReply();

    try {
      const instrucoes = getInstrucoes();
      const prompt = `${interaction.user.username} pediu pra você detonar ${alvo.username} com um roast pesado, sarcástico e engraçado. Faz um roast curto (máx 3 linhas) no teu estilo habitual. Sem piedade.`;

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: instrucoes },
            { role: "user",   content: prompt },
          ],
          max_tokens: 256,
          temperature: 0.95,
        }),
      });

      const data    = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Erro na API");
      const roast   = data.choices?.[0]?.message?.content || "Nem pra insultar presta.";
      const cortado = roast.length > 2000 ? roast.slice(0, 1997) + "..." : roast;

      const embed = new EmbedBuilder()
        .setColor(0xff4500)
        .setTitle(`🔥 Roast — ${alvo.username}`)
        .setDescription(cortado)
        .setFooter({ text: `Pedido por ${interaction.user.username} • powered by Grok` });

      await interaction.editReply({ embeds: [embed] });

    } catch (e) {
      console.error("Erro roast:", e.message);
      await interaction.editReply({ content: "❌ Deu erro. A vítima escapou por hoje." });
    }
  }

  // COMANDOS
  if (commandName === "comandos") {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📋 Comandos do servidor")
      .addFields(
        {
          name: "🎮 Cassino & Jogos",
          value:
            "`/slot` — Slot machine\n" +
            "`/blackjack` — 21 contra o bot\n" +
            "`/roleta` — Dobra ou perde\n" +
            "`/duel @user` — Duelo de pontos\n" +
            "`/trivia` — Pergunta por pontos",
        },
        {
          name: "💰 Pontos",
          value:
            "`/diario` — Recompensa diária (50-200 pts)\n" +
            "`/rank` — Teus pontos\n" +
            "`/top` — Top 10 do servidor",
        },
        {
          name: "🤖 IA (Grok)",
          value:
            "`/gpt` — Faz uma pergunta\n" +
            "`/roast @user` — Detona alguém\n" +
            "Ou só me menciona no chat",
        },
        {
          name: "😂 Diversão",
          value:
            "`/gado` — Gadômetro\n" +
            "`/ship` — Compatibilidade\n" +
            "`/beijar` `/abracar` `/tapa` — Interações\n" +
            "`/giveaway` — Sorteio\n" +
            "`/poll` — Votação",
        },
        {
          name: "📡 Stream",
          value:
            "`/redes` — Links do streamer\n" +
            "`/schedule` — Agenda de lives\n" +
            "`/clip` — Clip aleatório\n" +
            "`/hype` — Aviso de live",
        },
      )
      .setFooter({ text: "Dúvidas? Menciona o bot no chat" });

    return interaction.reply({ embeds: [embed] });
  }

  // GADO
  if (commandName === "gado") {
    const alvo = interaction.options.getUser("usuario") || interaction.user;
    const pct  = Math.floor(Math.random() * 101);
    const barra = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));

    const gifs = [
      "https://media.tenor.com/8Q2Hx5tHd8QAAAAM/gado-boi.gif",
      "https://media.tenor.com/X6mFCCiJfokAAAAM/cow-moo.gif",
      "https://media.tenor.com/9k4GpCmFmkMAAAAM/vaca-cow.gif",
    ];
    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    const nivel =
      pct >= 90 ? "🐄 GADO SUPREMO" :
      pct >= 70 ? "🐄 Muito gado" :
      pct >= 50 ? "😬 Meio gado" :
      pct >= 30 ? "😏 Levemente gado" :
                  "😎 Não é gado";

    const embed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setTitle("🐄 Gadômetro")
      .setDescription(`**${alvo.username}** é **${pct}% gado**\n\n\`[${barra}]\` ${pct}%\n\n${nivel}`)
      .setImage(gif)
      .setFooter({ text: "Resultados cientificamente comprovados 🔬" });
    return interaction.reply({ embeds: [embed] });
  }

  // BEIJAR
  if (commandName === "beijar") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === interaction.user.id)
      return interaction.reply({ content: "❌ Não dá pra se beijar sozinho... ainda.", ephemeral: true });

    const gifs = [
      "https://media.tenor.com/s-hc_4dBaHkAAAAM/anime-kiss.gif",
      "https://media.tenor.com/o9M68LRlWakAAAAM/kiss-anime.gif",
      "https://media.tenor.com/5SXcqKaqhKcAAAAM/anime-kiss-cute.gif",
    ];
    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    const embed = new EmbedBuilder()
      .setColor(0xff69b4)
      .setTitle("💋 Beijo!")
      .setDescription(`**${interaction.user.username}** beijou **${alvo.username}**! 💕`)
      .setImage(gif);
    return interaction.reply({ embeds: [embed] });
  }

  // ABRAÇAR
  if (commandName === "abracar") {
    const alvo = interaction.options.getUser("usuario");
    const gifs = [
      "https://media.tenor.com/od_6o9LBHN8AAAAM/anime-hug.gif",
      "https://media.tenor.com/a_j_RsWDseoAAAAM/hug-anime.gif",
      "https://media.tenor.com/GqHWOJkuLkMAAAAM/anime-hug.gif",
    ];
    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    const embed = new EmbedBuilder()
      .setColor(0xffa500)
      .setTitle("🤗 Abraço!")
      .setDescription(`**${interaction.user.username}** abraçou **${alvo.username}**! 💛`)
      .setImage(gif);
    return interaction.reply({ embeds: [embed] });
  }

  // TAPA
  if (commandName === "tapa") {
    const alvo = interaction.options.getUser("usuario");
    if (alvo.id === interaction.user.id)
      return interaction.reply({ content: "❌ Auto-tapa? Respeita a ti mesmo.", ephemeral: true });

    const gifs = [
      "https://media.tenor.com/fhDSYkSbhroAAAAM/anime-slap.gif",
      "https://media.tenor.com/FnSKUcZJdXYAAAAM/slap-anime.gif",
      "https://media.tenor.com/OiKkWlQJ_EoAAAAM/anime-slap-face.gif",
    ];
    const gif = gifs[Math.floor(Math.random() * gifs.length)];

    const embed = new EmbedBuilder()
      .setColor(0xff4500)
      .setTitle("👋 TAPA!")
      .setDescription(`**${interaction.user.username}** deu um tapa em **${alvo.username}**! 😤`)
      .setImage(gif);
    return interaction.reply({ embeds: [embed] });
  }

  // SHIP
  if (commandName === "ship") {
    const u1  = interaction.options.getUser("usuario1");
    const u2  = interaction.options.getUser("usuario2") || interaction.user;
    const pct = Math.floor(Math.random() * 101);
    const barra = "❤️".repeat(Math.floor(pct / 10)) + "🖤".repeat(10 - Math.floor(pct / 10));

    const nivel =
      pct >= 90 ? "💍 Alma gêmea!" :
      pct >= 70 ? "💖 Muito compatíveis!" :
      pct >= 50 ? "💛 Tem potencial" :
      pct >= 30 ? "🤔 Mais ou menos..." :
                  "💔 Nem a pau";

    const shipName = u1.username.slice(0, Math.ceil(u1.username.length / 2)) +
                     u2.username.slice(Math.floor(u2.username.length / 2));

    const embed = new EmbedBuilder()
      .setColor(0xff1493)
      .setTitle("💘 Shipmeter")
      .setDescription(
        `**${u1.username}** 💞 **${u2.username}**\n\n` +
        `Ship name: **${shipName}**\n\n` +
        `${barra}\n**${pct}% compatíveis**\n\n${nivel}`
      )
      .setFooter({ text: "Resultado garantido pela ciência do amor 💫" });
    return interaction.reply({ embeds: [embed] });
  }

  // ── CONFIG ────────────────────────────────────────────────
  if (commandName === "config") {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Apenas o dono pode usar `/config`.", ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const cfg = getCfg();

    // VER
    if (sub === "ver") {
      const r = cfg.redes;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⚙️ Configuração Atual")
        .addFields(
          { name: "🟣 Twitch Username",   value: cfg.twitch_username      || "❌ Não definido", inline: true },
          { name: "🔔 Canal de Live",      value: cfg.notif_channel_id     ? `<#${cfg.notif_channel_id}>` : "❌ Não definido", inline: true },
          { name: "💡 Canal Sugestões",    value: cfg.sugestao_channel_id  ? `<#${cfg.sugestao_channel_id}>` : "❌ Não definido", inline: true },
          { name: "📱 Redes",
            value: [
              r.twitch    ? `🟣 ${r.twitch}`    : "🟣 Twitch: ❌",
              r.tiktok    ? `🎵 ${r.tiktok}`    : "🎵 TikTok: ❌",
              r.instagram ? `📸 ${r.instagram}` : "📸 Instagram: ❌",
              r.youtube   ? `▶️ ${r.youtube}`   : "▶️ YouTube: ❌",
              r.discord   ? `💬 ${r.discord}`   : "💬 Discord: ❌",
            ].join("\n"), inline: false },
          { name: "🎬 Clips",    value: cfg.clips.length > 0 ? cfg.clips.map(c => `• ${c.nome}`).join("\n") : "❌ Nenhum", inline: true },
        )
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // TWITCH USERNAME
    if (sub === "twitch") {
      cfg.twitch_username = interaction.options.getString("username");
      saveCfg(cfg);
      client.user.setActivity(`twitch.tv/${cfg.twitch_username} 🔴`, { type: 1 });
      return interaction.reply({ content: `✅ Twitch definida como **${cfg.twitch_username}**.`, ephemeral: true });
    }

    // CANAL NOTIF
    if (sub === "canal_notif") {
      cfg.notif_channel_id = interaction.options.getChannel("canal").id;
      saveCfg(cfg);
      return interaction.reply({ content: `✅ Canal de notificações definido como <#${cfg.notif_channel_id}>.`, ephemeral: true });
    }

    // CANAL SUGESTÃO
    if (sub === "canal_sugestao") {
      cfg.sugestao_channel_id = interaction.options.getChannel("canal").id;
      saveCfg(cfg);
      return interaction.reply({ content: `✅ Canal de sugestões definido como <#${cfg.sugestao_channel_id}>.`, ephemeral: true });
    }

    // REDE SOCIAL
    if (sub === "rede") {
      const nome = interaction.options.getString("nome");
      const url  = interaction.options.getString("url");
      cfg.redes[nome] = url;
      saveCfg(cfg);
      return interaction.reply({ content: `✅ **${nome}** atualizado para: ${url}`, ephemeral: true });
    }

    // SCHEDULE
    if (sub === "schedule") {
      const dia     = interaction.options.getString("dia");
      const horario = interaction.options.getString("horario");
      const jogo    = interaction.options.getString("jogo") || "";
      const idx     = cfg.schedule.findIndex(s => s.dia === dia);
      if (idx !== -1) cfg.schedule[idx] = { dia, horario, jogo };
      else cfg.schedule.push({ dia, horario, jogo });
      saveCfg(cfg);
      return interaction.reply({ content: `✅ **${dia}** atualizado: \`${horario}\` — ${jogo || "sem jogo definido"}`, ephemeral: true });
    }

    // CLIP ADD
    if (sub === "clip_add") {
      const nome = interaction.options.getString("nome");
      const url  = interaction.options.getString("url");
      cfg.clips.push({ nome, url });
      saveCfg(cfg);
      return interaction.reply({ content: `✅ Clip **${nome}** adicionado!`, ephemeral: true });
    }

    // CLIP REMOVE
    if (sub === "clip_remove") {
      const nome  = interaction.options.getString("nome");
      const antes = cfg.clips.length;
      cfg.clips   = cfg.clips.filter(c => c.nome.toLowerCase() !== nome.toLowerCase());
      saveCfg(cfg);
      return interaction.reply({
        content: cfg.clips.length < antes ? `✅ Clip **${nome}** removido.` : `❌ Clip **${nome}** não encontrado.`,
        ephemeral: true,
      });
    }

    if (sub === "canal_logs") {
      cfg.logs_channel_id = interaction.options.getChannel("canal").id;
      saveCfg(cfg);
      return interaction.reply({ content: `✅ Canal de logs definido como <#${cfg.logs_channel_id}>.`, ephemeral: true });
    }
  }

  // ── OWNER ─────────────────────────────────────────────────
  if (commandName === "owner") {
    if (interaction.user.id !== OWNER_ID)
      return interaction.reply({ content: "❌ Apenas o dono pode usar este comando.", ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === "say") {
      const canal = interaction.options.getChannel("canal");
      await canal.send(interaction.options.getString("mensagem"));
      return interaction.reply({ content: `✅ Mensagem enviada em ${canal}.`, ephemeral: true });
    }
    if (sub === "embed") {
      const canal  = interaction.options.getChannel("canal");
      const titulo = interaction.options.getString("titulo");
      const desc   = interaction.options.getString("descricao") || "";
      await canal.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(titulo).setDescription(desc).setTimestamp()] });
      return interaction.reply({ content: `✅ Embed enviado em ${canal}.`, ephemeral: true });
    }
    if (sub === "status") {
      const texto = interaction.options.getString("texto");
      await client.user.setActivity(texto, { type: 0 });
      return interaction.reply({ content: `✅ Status: **${texto}**`, ephemeral: true });
    }
    if (sub === "darpontos") {
      const alvo  = interaction.options.getUser("usuario");
      const qtd   = interaction.options.getInteger("quantidade");
      const total = addPontos(alvo.id, qtd);
      sendLog(interaction.guild, "admin",
        `🔧 **${interaction.user.username}** deu **${qtd} pts** a **${alvo.username}**`
      );
      return interaction.reply({ content: `✅ ${alvo.username} agora tem **${total}** pontos.`, ephemeral: true });
    }

    if (sub === "loja_add") {
      const db       = loadDB();
      if (!db.loja) db.loja = [];
      const nome     = interaction.options.getString("nome");
      const preco    = interaction.options.getInteger("preco");
      const desc     = interaction.options.getString("descricao");
      const cargo_id = interaction.options.getString("cargo_id") || null;
      if (db.loja.find(i => i.nome.toLowerCase() === nome.toLowerCase()))
        return interaction.reply({ content: `❌ Já existe um item **${nome}**.`, ephemeral: true });
      db.loja.push({ nome, preco, descricao: desc, cargo_id });
      markDirty(); saveDB();
      return interaction.reply({ content: `✅ **${nome}** adicionado à loja por **${preco} pts**.`, ephemeral: true });
    }

    if (sub === "loja_remove") {
      const db   = loadDB();
      const nome = interaction.options.getString("nome");
      const antes = (db.loja || []).length;
      db.loja = (db.loja || []).filter(i => i.nome.toLowerCase() !== nome.toLowerCase());
      markDirty(); saveDB();
      return interaction.reply({
        content: (db.loja.length < antes) ? `✅ Item **${nome}** removido.` : `❌ Item **${nome}** não encontrado.`,
        ephemeral: true,
      });
    }
  } catch (e) {
    console.error(`❌ Erro no comando /${interaction.commandName}:`, e.message);
    const msg = { content: "❌ Ocorreu um erro inesperado. Tenta de novo.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.login(TOKEN);

// ─── RESPOSTA POR MENÇÃO ───────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;

  // Remove a menção do texto
  const texto = message.content
    .replace(/<@!?[\d]+>/g, "")
    .trim();

  if (!texto) {
    return message.reply("Oi? Fala logo, não tenho o dia todo.");
  }

  try {
    const instrucoes = getInstrucoes();
    const historico  = getHistorico(message.author.id);

    const messages = [
      { role: "system", content: instrucoes },
      ...historico,
      { role: "user", content: texto },
    ];

    // Mostra que está digitando
    await message.channel.sendTyping();

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages,
        max_tokens: 512,
        temperature: 0.8,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "Erro na API");

    const resposta = data.choices?.[0]?.message?.content || "...";

    // Salva no mesmo histórico do /gpt
    historico.push({ role: "user", content: texto });
    historico.push({ role: "assistant", content: resposta });
    salvarHistorico(message.author.id, historico);

    // Corta se passar do limite do Discord
    const cortada = resposta.length > 2000 ? resposta.slice(0, 1997) + "..." : resposta;

    await message.reply(cortada);

  } catch (e) {
    console.error("Erro menção IA:", e.message);
    await message.reply("Deu erro. Tenta de novo ou deixa quieto.").catch(() => {});
  }
});

// ─── PROTEÇÃO GLOBAL CONTRA CRASHES ───────────────────────
process.on("unhandledRejection", (err) => {
  console.error("❌ [unhandledRejection]", err?.message || err);
});

process.on("uncaughtException", (err) => {
  console.error("❌ [uncaughtException]", err?.message || err);
  // Não deixa o processo morrer por erros inesperados
});
