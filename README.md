<div align="center">

<img src="https://cdn.discordapp.com/emojis/1234567890.webp" width="80" alt="04 chan" />

# 04 chan Bot

**Bot oficial do servidor do streamer 04.**
IA com personalidade, economia, cassino e notificações de live.

[![Discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.js.org)
[![Node.js](https://img.shields.io/badge/node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/postgresql-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Groq](https://img.shields.io/badge/groq-llama--3.3--70b-F55036?style=flat-square)](https://groq.com)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## ✨ Funcionalidades

### 📡 Stream
| Comando | Descrição |
|---|---|
| `/redes` | Links de todas as redes do streamer |
| `/schedule` | Agenda de lives da semana |
| `/clip` | Clip aleatório |
| `/hype [jogo]` | Embed de live ao vivo com @everyone |
| `/sugestao <texto>` | Envia sugestão ao streamer |

### 🤖 IA — 04 chan
| Comando | Descrição |
|---|---|
| `/gpt <pergunta>` | Conversa com a 04 chan |
| `/roast @user` | 04 chan detona alguém |
| `@04chan <mensagem>` | Menciona no chat para resposta direta |

> A IA tem memória por utilizador e personalidade própria. Configurável via `/painel` → IA.

### 💰 Economia
| Comando | Descrição |
|---|---|
| `/diario` | Recompensa diária (50–200 pts) |
| `/missao` | Missão diária gerada pela IA |
| `/missao_concluir` | Conclui a missão e recebe pontos |
| `/crime [alvo]` | Tenta um crime — ganha ou perde pts (cooldown 1h) |
| `/transferir @user <qtd>` | Transfere pontos |
| `/loja` | Loja de itens e cargos |
| `/comprar <item>` | Compra item da loja |
| `/inventario` | Vê os teus itens |

### 📊 Perfil & Ranking
| Comando | Descrição |
|---|---|
| `/perfil [@user]` | Card com nível, pontos, stats e missão |
| `/rank` | Teus pontos e posição |
| `/top` | Top 10 do servidor |

### 🎰 Cassino
| Comando | Descrição |
|---|---|
| `/slot <aposta>` | Slot machine — multiplicadores até x10 |
| `/blackjack <aposta>` | Blackjack contra o bot com botões |
| `/roleta <aposta>` | Dobra ou perde — 50/50 |
| `/duel @user [aposta]` | Duelo com aceitação por botão |
| `/trivia` | Pergunta de 20s por pontos |
| `/giveaway <prémio>` | Sorteio por reação (só dono) |
| `/poll <pergunta>` | Votação com até 5 opções |

### 😂 Diversão
| Comando | Descrição |
|---|---|
| `/gado [@user]` | Gadômetro 0–100% |
| `/ship @u1 [@u2]` | Compatibilidade com ship name |
| `/beijar @user` | GIF de beijo |
| `/abracar @user` | GIF de abraço |
| `/tapa @user` | GIF de tapa |

### ⚙️ Admin
| Comando | Descrição |
|---|---|
| `/painel` | Painel completo de configurações (só dono) |
| `/comandos` | Lista todos os comandos |

---

## 🚀 Setup

### Variáveis de ambiente

| Variável | Onde pegar |
|---|---|
| `TOKEN` | [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Token |
| `CLIENT_ID` | Developer Portal → Application ID |
| `OWNER_ID` | Discord → Configurações → Avançado → Modo Dev → clica no teu perfil → Copiar ID |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys |
| `DATABASE_URL` | Railway → PostgreSQL → Connect → Database URL |

### Deploy no Railway (recomendado)

1. Cria conta em [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub** — conecta o repo
3. Adiciona um **PostgreSQL** ao projeto (New → Database → PostgreSQL)
4. Em **Variables**, adiciona as 5 variáveis acima
5. Deploy automático ✅

> O `DATABASE_URL` do PostgreSQL é injetado automaticamente pelo Railway se adicionares o banco ao mesmo projeto.

### Rodar local (Termux / Linux)

```bash
npm install
node bot.js
```

> Sem `DATABASE_URL`, o bot inicia sem persistência (útil para testes rápidos).

### Deploy com PM2 (VPS)

```bash
npm install -g pm2
pm2 start bot.js --name 04chan
pm2 save && pm2 startup
```

---

## ⚙️ Painel de Configurações

O `/painel` substitui todos os comandos de config. Abre um menu interativo com 6 secções:

| Secção | O que configura |
|---|---|
| ⚙️ Configurações Gerais | Twitch username, canais de live/sugestões/logs, credenciais Twitch |
| 📱 Redes Sociais | Links de Twitch, TikTok, Instagram, YouTube, Discord |
| 📅 Agenda | Horário e jogo por dia da semana |
| 🎬 Clips | Adicionar e remover clips |
| 🛒 Loja | Adicionar/remover itens, definir preço e cargo |
| 🤖 IA | Editar instruções da 04 chan, limpar memória |

---

## 🧠 Personalidade da IA

A 04 chan usa o modelo `llama-3.3-70b-versatile` da Groq com memória por utilizador (últimas 10 mensagens por pessoa).

A personalidade de fábrica já está configurada — debochada, estressada, brincalhona, fala como alguém do chat.

Para personalizar: `/painel` → 🤖 IA → Editar instruções.

---

## 🗄️ Base de Dados

PostgreSQL com as seguintes tabelas criadas automaticamente no primeiro boot:

| Tabela | Dados |
|---|---|
| `usuarios` | Pontos, nível, stats, timestamps |
| `config` | Configurações do servidor (chave-valor) |
| `loja` | Itens disponíveis na loja |
| `inventario` | Itens comprados por utilizador |
| `missoes` | Missões diárias activas |
| `ia_historico` | Histórico de conversa por utilizador |
| `logs` | Registo de ações (duelos, crimes, compras…) |

---

## 🛠️ Stack

| Tecnologia | Uso |
|---|---|
| [Discord.js v14](https://discord.js.org) | Framework do bot |
| [Groq API](https://groq.com) | IA — llama-3.3-70b-versatile |
| [PostgreSQL](https://postgresql.org) + [node-postgres](https://node-postgres.com) | Base de dados |
| [Node.js 18+](https://nodejs.org) | Runtime |

---

## 📄 Licença

MIT — vê o arquivo [LICENSE](LICENSE) para detalhes.
