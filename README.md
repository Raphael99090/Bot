# 🤖 Grok Bot

> Bot de Discord para servidores de streamers. IA com personalidade, sistema de pontos, cassino e notificações de live.

---

## ✨ Funcionalidades

### 🔴 Stream
| Comando | Descrição |
|---|---|
| `/redes` | Mostra todos os links do streamer |
| `/schedule` | Agenda de lives da semana |
| `/clip` | Clip aleatório da Twitch |
| `/hype [jogo]` | Manda aviso de live com @everyone |
| `/sugestao <texto>` | Envia sugestão pro canal configurado |

### 🤖 IA (Grok)
| Comando | Descrição |
|---|---|
| `/gpt <pergunta>` | Faz uma pergunta para a IA |
| `/roast @user` | IA detona alguém no estilo do servidor |
| `@Grok <mensagem>` | Menciona o bot no chat para conversar |
| `/ia_config instrucoes` | Define a personalidade da IA |
| `/ia_config ver` | Mostra as instruções atuais |
| `/ia_config limpar_memoria` | Limpa o histórico de conversa |

### 💰 Pontos & Perfil
| Comando | Descrição |
|---|---|
| `/diario` | Recompensa diária de 50–200 pontos |
| `/rank` | Vê os teus pontos e posição |
| `/top` | Top 10 do servidor |
| `/perfil [@user]` | Card completo com nível, stats e histórico |

### 🎰 Cassino
| Comando | Descrição |
|---|---|
| `/slot <aposta>` | Slot machine com 7 símbolos e multiplicadores até x10 |
| `/blackjack <aposta>` | Joga 21 contra o bot com botões interativos |
| `/roleta <aposta>` | Dobra ou perde — 50/50 |
| `/duel @user [aposta]` | Duelo de pontos com aceitação por botão |
| `/giveaway <prémio>` | Sorteio por reação (só dono) |

### 🎮 Jogos & Diversão
| Comando | Descrição |
|---|---|
| `/trivia` | Pergunta com 20s para responder e ganhar pontos |
| `/poll <pergunta> \| op1 \| op2` | Votação com reações |
| `/gado [@user]` | Gadômetro 0–100% |
| `/ship @user1 [@user2]` | Compatibilidade com ship name gerado |
| `/roast @user` | IA detona alguém com humor negro |
| `/beijar @user` | GIF de beijo |
| `/abracar @user` | GIF de abraço |
| `/tapa @user` | GIF de tapa |

### ⚙️ Configuração (só dono)
| Comando | Descrição |
|---|---|
| `/config ver` | Mostra toda a configuração atual |
| `/config twitch <username>` | Define o streamer da Twitch |
| `/config canal_notif <#canal>` | Canal de notificações de live |
| `/config canal_sugestao <#canal>` | Canal de sugestões |
| `/config rede <nome> <url>` | Atualiza uma rede social |
| `/config schedule <dia> <horario> <jogo>` | Edita a agenda |
| `/config clip_add <nome> <url>` | Adiciona um clip |
| `/config clip_remove <nome>` | Remove um clip |
| `/owner say <#canal> <msg>` | Bot fala num canal |
| `/owner embed <#canal> <título>` | Manda embed num canal |
| `/owner status <texto>` | Muda o status do bot |
| `/owner darpontos @user <qtd>` | Dá pontos a alguém |

---

## 🚀 Setup

### Variáveis de ambiente

| Variável | Onde pegar |
|---|---|
| `TOKEN` | [Discord Developer Portal](https://discord.com/developers/applications) → Bot → Token |
| `CLIENT_ID` | Developer Portal → Application ID |
| `OWNER_ID` | Discord → Configurações → Avançado → Modo Dev → clica no teu perfil → Copiar ID |
| `GROQ_API_KEY` | [console.groq.com](https://console.groq.com) → API Keys |

### Rodar local (Termux / Linux)

```bash
npm install
node bot.js
```

### Deploy no Railway

1. Sobe os ficheiros no GitHub (`bot.js` + `package.json`)
2. Cria projeto em [railway.app](https://railway.app) → Deploy from GitHub
3. Adiciona as 4 variáveis em **Variables**
4. Deploy automático ✅

### Deploy com PM2 (VPS)

```bash
npm install -g pm2
pm2 start bot.js --name grok
pm2 save && pm2 startup
```

---

## 🧠 Personalidade da IA

A IA usa o modelo `llama-3.3-70b-versatile` da Groq e tem memória por utilizador (últimas 10 mensagens).

Para definir a personalidade usa `/ia_config instrucoes`. Exemplo:

```
Você é o Grok, bot oficial do servidor do streamer 04.
Seja sarcástico, ácido e direto. Use humor negro.
Responda sempre em português. Respostas curtas.
```

---

## 🗄️ Dados

Tudo é salvo em `data.json` na raiz do projeto:
- Pontos dos utilizadores
- Configurações do servidor
- Histórico de conversa da IA
- Stats de jogos e duelos
- Timestamps do diário

---

## 🛠️ Stack

- **[Discord.js](https://discord.js.org)** v14
- **[Groq API](https://groq.com)** — llama-3.3-70b-versatile
- **Node.js** 18+
- Armazenamento em JSON local
