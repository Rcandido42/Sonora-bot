<p align="center">
  <img src="apps/web/public/branding/sonora-horizontal-dark.svg" alt="Sonora — Bot de Música Discord & Painel Web em Tempo Real" width="340" />
</p>

<h1 align="center">Sonora — Bot de Música Discord & Leitor Web em Tempo Real</h1>

A **Sonora** é uma plataforma musical completa (Bot Discord + Backend API/WebSocket + Painel Web React + Base de Dados SQLite) desenvolvida em **TypeScript** para execução nativa em **Windows** (e opcionalmente em servidores Linux/VPS 24/7), desenhada para um servidor Discord com reprodução de áudio real, fila partilhada em tempo real, permissões de DJ, playlists pessoais, favoritos, letras e autenticação Discord OAuth2.

---

## 1. Arquitetura do Monorepo

O projeto utiliza `npm workspaces` com separação estrita de responsabilidades:

| Pacote / Aplicação | Diretório | Responsabilidade |
| :--- | :--- | :--- |
| `@sonora/shared` | `packages/shared` | Identidade visual **Sonora**, validação Zod de variáveis `.env`, internacionalização (`pt-PT` e `en`), proteção anti-SSRF (DNS/IP privado) e logger estruturado (`pino`) com redação automática de segredos. |
| `@sonora/database` | `packages/database` | Persistência **SQLite (`better-sqlite3` em modo WAL)**, migrações automáticas, configurações do servidor, cargos de DJ, favoritos, playlists pessoais, histórico, sessões web OAuth2, cópia de segurança online e restauro verificado. |
| `@sonora/audio-engine` | `packages/audio-engine` | Motor de áudio real (`@discordjs/voice` + `prism-media` + `ffmpeg-static` + `yt-dlp`), adaptadores para **YouTube**, **SoundCloud**, **URLs diretos de áudio HTTPS**, correspondência inteligente de faixas do **Spotify** (apenas metadados via Web API / oEmbed) e serviço de letras (**LRCLIB** + **Genius**). |
| `@sonora/server` | `apps/server` | Cliente Discord (`discord.js` v14) com 16 comandos slash e botões interativos + Servidor **Fastify** com **Discord OAuth2**, cookies `HttpOnly` assinados, proteção **CSRF**, *rate limiting*, *Helmet*, *CORS* restrito e sincronização **WebSocket (`/ws`)**. |
| `@sonora/web` | `apps/web` | **Painel Web Sonora** em **React 19 + Vite + Tailwind CSS v4**, sincronizado em tempo real com o bot Discord. |

---

## 2. Requisitos no Windows

1. **Windows 10 ou Windows 11** (64-bit).
2. **Node.js 22 LTS ou 24+** e **npm 10+** instalados (`node -v` e `npm -v`).
3. **FFmpeg**: já incluído automaticamente através do pacote `ffmpeg-static` (ou podes definir um caminho personalizado em `FFMPEG_PATH`).
4. **yt-dlp**: o executável oficial para Windows encontra-se em `.bin/yt-dlp.exe` na raiz do projeto (configurado em `YTDLP_PATH`).

---

## 3. Configuração no Discord Developer Portal

1. Acede ao [Discord Developer Portal](https://discord.com/developers/applications) e seleciona a aplicação da **Sonora** (ou cria uma nova).
2. Na secção **General Information**:
   - Copia o **Application ID** para `DISCORD_CLIENT_ID` no teu `.env`.
   - Opcionalmente, carrega o avatar oficial em `apps/web/public/branding/discord-avatar-512.png`.
3. Na secção **Bot**:
   - Clica em **Reset Token** (se necessário) e copia o token para `DISCORD_TOKEN` no ficheiro `.env`.
   - Ativa a opção **Server Members Intent** caso pretendas sincronizar cargos detalhados em servidores grandes.
4. Na secção **OAuth2**:
   - Copia o **Client Secret** para `DISCORD_CLIENT_SECRET` no ficheiro `.env` (necessário para o botão *"Entrar com o Discord"* no Painel Web).
   - Em **Redirects**, adiciona o URL de callback:
     - Localmente: `http://localhost:3001/api/auth/callback`
     - Remotamente (via HTTPS / Cloudflare Tunnel): `https://oseuteudominio.trycloudflare.com/api/auth/callback`
5. **Convidar a Sonora para o teu Servidor Discord**:
   - Abre no navegador o seguinte URL (substituindo `SEU_CLIENT_ID` pelo teu `DISCORD_CLIENT_ID`):
     ```text
     https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&permissions=36700160&scope=bot%20applications.commands
     ```

---

## 4. Instalação e Ficheiro `.env`

1. Instala todas as dependências na raiz do projeto:
   ```powershell
   npm install
   ```
2. Copia `.env.example` para `.env` (se ainda não existir) e preenche as variáveis:

| Variável | Obrigatória | Descrição |
| :--- | :---: | :--- |
| `NODE_ENV` | Sim | `development` (local) ou `production` (acesso remoto / VPS). |
| `DEFAULT_LANGUAGE` | Sim | Idioma padrão (`pt-PT` ou `en`). |
| `LOG_LEVEL` | Sim | Nível de registo (`info`, `debug`, `warn`, `error`). |
| `DISCORD_TOKEN` | **Sim** | Token secreto do Bot Discord. |
| `DISCORD_CLIENT_ID` | **Sim** | Application ID (Snowflake de 17–20 dígitos) do Bot Discord. |
| `DISCORD_GUILD_ID` | **Sim** | ID do teu servidor Discord (ou `000000000000000000` para deteção automática do primeiro servidor onde o bot está presente). |
| `DISCORD_CLIENT_SECRET` | Para OAuth2 | Client Secret OAuth2 para login com conta Discord no Painel Web. |
| `OAUTH_REDIRECT_URI` | Sim | URL de retorno OAuth2 (ex.: `http://localhost:3001/api/auth/callback`). |
| `SESSION_SECRET` | **Sim** | Segredo criptográfico com pelo menos 32 caracteres para assinar cookies de sessão. |
| `SESSION_TTL_SECONDS` | Sim | Duração da sessão web em segundos (padrão: `604800` = 7 dias). |
| `HOST` | Sim | `127.0.0.1` para uso local ou `0.0.0.0` em contentor/VPS. |
| `PORT` | Sim | Porta HTTP do servidor Fastify (padrão: `3001`). |
| `PUBLIC_WEB_URL` | Sim | URL público do Painel Web (ex.: `http://localhost:5173` em dev ou `http://localhost:3001` em produção). |
| `TRUST_PROXY` | Sim | `true` quando exposto atrás de Cloudflare Tunnel ou Reverse Proxy HTTPS. |
| `DATABASE_PATH` | Sim | Caminho do ficheiro SQLite (padrão: `./data/sonora.db`). |
| `BACKUP_DIR` | Sim | Diretório onde são guardadas as cópias de segurança (padrão: `./backups`). |
| `SPOTIFY_CLIENT_ID` | Opcional | Client ID da API do Spotify (se omitido, usa oEmbed público oficial do Spotify para identificar faixas). |
| `SPOTIFY_CLIENT_SECRET` | Opcional | Client Secret da API do Spotify. |
| `GENIUS_ACCESS_TOKEN` | Opcional | Token da API Genius para enriquecer links de letras. |
| `YTDLP_PATH` | Opcional | Caminho para o binário `yt-dlp` (padrão no projeto: `./.bin/yt-dlp.exe`). |

---

## 5. Como Iniciar a Sonora no Windows

### Opção A — Atalhos Rápidos (1 Clique no Windows)
Na pasta raiz do projeto encontras três atalhos prontos a usar:
- **`Iniciar-Sonora.bat`**: Abre a consola da Sonora e mantém o Bot Discord + Servidor Web ativos.
- **`Iniciar-Sonora-Silencioso.vbs`**: Inicia a Sonora em segundo plano no Windows sem janela visível (podes também colocá-lo na pasta de arranque `shell:startup` do Windows para ligar sozinho quando inicias o PC).
- **`Parar-Sonora.bat`**: Encerra o processo da Sonora em execução.

### Opção B — Via Terminal (Desenvolvimento ou Produção)
```powershell
# 1. Compilar todos os pacotes (Shared, Database, Audio Engine, Server e Painel Web)
npm run build

# 2. Registar manualmente os 16 comandos slash no Discord (também ocorre automaticamente no arranque)
npm run register:commands

# 3. Iniciar o Bot Discord + API/WebSocket + Painel Web compilado na porta 3001
npm start
```
Se quiseres desenvolver o frontend com *Hot Reload* (Vite na porta `5173` + Servidor na porta `3001`):
```powershell
# Terminal 1 (Bot + Backend Fastify na porta 3001)
npm run dev:server

# Terminal 2 (Painel Web Vite na porta 5173)
npm run dev:web
```

---

## 6. Comandos Slash no Discord (16 Comandos)

| Comando | Descrição | Permissão |
| :--- | :--- | :--- |
| `/play <pesquisa_ou_url>` | Toca ou adiciona à fila a partir do YouTube, SoundCloud, link de faixa Spotify ou URL direto HTTPS. | Qualquer membro em canal de voz |
| `/pause` | Coloca a reprodução atual em pausa. | Autor do pedido, DJ ou Admin |
| `/resume` | Retoma a reprodução da faixa em pausa. | Autor do pedido, DJ ou Admin |
| `/skip` | Avança para a próxima música da fila. | Autor do pedido, DJ ou Admin |
| `/stop` | Para a reprodução e limpa a fila. | DJ ou Admin |
| `/leave` | Desliga a Sonora do canal de voz. | DJ ou Admin |
| `/volume <0-200>` | Ajusta o volume de reprodução em tempo real (`0%` a `200%`). | DJ ou Admin |
| `/nowplaying` | Apresenta o cartão interativo da música atual com progresso e botões. | Todos |
| `/queue [pagina]` | Lista as próximas músicas na fila partilhada do servidor. | Todos |
| `/remove <posicao>` | Remove uma música específica da fila pela sua posição. | DJ ou Admin |
| `/clear` | Remove todas as músicas em espera na fila. | DJ ou Admin |
| `/shuffle` | Baralha aleatoriamente a fila de reprodução. | DJ ou Admin |
| `/loop <off\|track\|queue>` | Altera o modo de repetição (Desativado, Faixa atual ou Fila inteira). | DJ ou Admin |
| `/lyrics [pesquisa]` | Obtém a letra sincronizada/completa via LRCLIB e ligação para o Genius. | Todos |
| `/help` | Mostra a lista completa de comandos e funcionalidades da Sonora. | Todos |
| `/language <pt-PT\|en>` | Altera o idioma do bot e do utilizador entre Português (Portugal) e Inglês. | Todos (pessoal) / Admin (servidor) |

---

## 7. Base de Dados SQLite, Cópia de Segurança e Restauro

A base de dados SQLite é inicializada e migrada automaticamente no arranque em `./data/sonora.db` (com `journal_mode = WAL` e `foreign_keys = ON`).

- **Criar Cópia de Segurança Online (sem parar o bot)**:
  ```powershell
  npm run db:backup
  ```
  Gera um ficheiro `.db` consistente e um manifesto `.json` com hash SHA-256 na pasta `./backups`.

- **Restaurar uma Cópia de Segurança (com validação de integridade `PRAGMA integrity_check`)**:
  ```powershell
  npm run db:restore -- "./backups/sonora-backup-AAAA-MM-DD.db"
  ```

---

## 8. Testes Automatizados e Verificação de Tipos

Para executar toda a bateria de testes unitários, de integração e de interface (Vitest + Testing Library):
```powershell
npm run typecheck
npm test
```

---

## 9. Acesso Remoto Seguro via HTTPS no Windows (Cloudflare Tunnel)

Para permitires que outros membros do teu servidor Discord acedam ao **Painel Web Sonora** fora da tua rede local com **HTTPS** seguro:

1. Compila o projeto (`npm run build`) para que o Fastify sirva o Painel Web diretamente na porta `3001`.
2. Instala o `cloudflared` no Windows:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
3. Abre um túnel HTTPS apontando para a porta local `3001`:
   ```powershell
   cloudflared tunnel --url http://127.0.0.1:3001
   ```
4. Copia o endereço HTTPS gerado (ex.: `https://sonora-exemplo.trycloudflare.com`) e atualiza no teu `.env`:
   ```env
   PUBLIC_WEB_URL=https://sonora-exemplo.trycloudflare.com
   OAUTH_REDIRECT_URI=https://sonora-exemplo.trycloudflare.com/api/auth/callback
   TRUST_PROXY=true
   ```
5. Adiciona esse mesmo `OAUTH_REDIRECT_URI` na aba **OAuth2 -> Redirects** do Discord Developer Portal e reinicia a Sonora.

---

## 10. Comportamento com o PC Desligado & Alojamento 24/7 (VPS / Cloud)

- **Execução Local no PC**: Enquanto o teu PC estiver ligado e a Sonora estiver em execução, qualquer amigo no teu servidor Discord pode usar `/play` ou o Painel Web sem precisares de fazer nada. Se o teu PC for totalmente desligado, o processo local deixa de ter energia e rede, pelo que o bot fica *Offline* até voltares a ligar o PC.
- **Execução 24/7 com o PC Desligado (Opcional)**: O projeto já inclui configuração pronta para correr 24 horas por dia numa VPS gratuita (como *Oracle Cloud Free Tier*) ou qualquer servidor Linux/Docker:
  - **Com Docker**:
    ```bash
    docker build -t sonora-bot .
    docker run -d --name sonora --restart unless-stopped --env-file .env -p 3001:3001 -v $(pwd)/data:/app/data -v $(pwd)/backups:/app/backups sonora-bot
    ```
  - **Com PM2 (Node.js direto em VPS)**:
    ```bash
    npm install
    npm run build
    npx pm2 start ecosystem.config.cjs
    npx pm2 save
    npx pm2 startup
    ```

---

## 11. Resolução de Problemas Comuns (Troubleshooting)

- **O bot responde ao comando `/play`, mas não entra no canal de voz**:
  - Certifica-te de que estás ligado a um canal de voz no servidor Discord antes de executar `/play` e de que o bot tem as permissões **Ver Canal (View Channel)**, **Ligar (Connect)** e **Falar (Speak)** nesse canal.
- **Erro `OAUTH_SECRET_MISSING` ao clicar em "Entrar com o Discord" no Painel Web**:
  - Preenche `DISCORD_CLIENT_SECRET` no ficheiro `.env` com o *Client Secret* da secção OAuth2 do Discord Developer Portal, ou utiliza o botão **"Acesso Rápido Local (Administrador no PC)"** quando estiveres a aceder localmente em modo `development`.
- **Faixas do Spotify**:
  - Por conformidade técnica e legal, a Sonora nunca extrai fluxos de áudio do Spotify; identifica o título, artista e duração da faixa do Spotify e encontra automaticamente a melhor correspondência no YouTube ou SoundCloud para reprodução.
