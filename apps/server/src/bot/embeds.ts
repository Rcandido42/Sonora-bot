import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from 'discord.js';
import {
  SONORA_BRAND,
  formatDuration,
  t,
  type PlayerStateSnapshot,
  type SupportedLocale
} from '@sonora/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackCoverPath = path.resolve(
  __dirname,
  '../../../../apps/web/public/branding/cover-fallback-512.png'
);

export function createSonoraStatusEmbed(
  description: string,
  variant: 'accent' | 'error' | 'warning' | 'idle' = 'accent',
  title?: string
): EmbedBuilder {
  const colorMap = {
    accent: SONORA_BRAND.colors.discordEmbedAccent,
    error: SONORA_BRAND.colors.discordEmbedError,
    warning: SONORA_BRAND.colors.discordEmbedWarning,
    idle: SONORA_BRAND.colors.discordEmbedIdle
  };

  const embed = new EmbedBuilder()
    .setColor(colorMap[variant])
    .setDescription(description)
    .setFooter({ text: SONORA_BRAND.upperName });

  if (title) {
    embed.setTitle(title);
  }

  return embed;
}

export function createSonoraNowPlayingPayload(
  state: PlayerStateSnapshot,
  locale: SupportedLocale = 'pt-PT'
): {
  embeds: [EmbedBuilder];
  components: [ActionRowBuilder<ButtonBuilder>];
  files: AttachmentBuilder[];
} {
  const isPt = locale === 'pt-PT';
  const track = state.currentTrack;

  if (!track) {
    return {
      embeds: [createSonoraStatusEmbed(t(locale, 'common.error.nothingPlaying'), 'idle')],
      components: [new ActionRowBuilder<ButtonBuilder>()],
      files: []
    };
  }

  const isPaused = state.status === 'paused';
  const statusLabel = isPaused
    ? isPt
      ? '⏸ Em Pausa'
      : '⏸ Paused'
    : isPt
      ? '▶ A Reproduzir'
      : '▶ Playing';

  const loopLabelMap = {
    off: isPt ? 'Desativado' : 'Off',
    track: isPt ? 'Faixa Atual' : 'Track',
    queue: isPt ? 'Toda a Fila' : 'Queue'
  };

  const sourceLabelMap = {
    youtube: 'YouTube',
    soundcloud: 'SoundCloud',
    direct: isPt ? 'Áudio Direto' : 'Direct Audio'
  };

  const embed = new EmbedBuilder()
    .setColor(SONORA_BRAND.colors.discordEmbedAccent)
    .setAuthor({
      name: `${SONORA_BRAND.upperName} • ${statusLabel}`
    })
    .setTitle(track.title)
    .setURL(track.sourceUrl)
    .setDescription(`**${track.artist}**`)
    .addFields(
      {
        name: isPt ? 'Duração' : 'Duration',
        value: `\`${formatDuration(track.durationMs)}\``,
        inline: true
      },
      {
        name: isPt ? 'Volume' : 'Volume',
        value: `\`${state.volume}%\``,
        inline: true
      },
      {
        name: isPt ? 'Repetição' : 'Repeat',
        value: `\`${loopLabelMap[state.loopMode]}\``,
        inline: true
      },
      {
        name: isPt ? 'Fonte' : 'Source',
        value: track.matchedFromSpotifyUrl
          ? `Spotify → ${sourceLabelMap[track.source]}`
          : sourceLabelMap[track.source],
        inline: true
      },
      {
        name: isPt ? 'Na Fila' : 'In Queue',
        value: `\`${state.queue.length}\``,
        inline: true
      },
      {
        name: isPt ? 'Pedido por' : 'Requested by',
        value: track.requestedBy
          ? track.requestedBy.displayName ?? track.requestedBy.username
          : isPt
            ? 'Painel Web Sonora'
            : 'Sonora Web Player',
        inline: true
      }
    )
    .setFooter({
      text: `${SONORA_BRAND.upperName} • ${SONORA_BRAND.tagline[locale]}`
    });

  const files: AttachmentBuilder[] = [];
  if (track.artworkUrl) {
    embed.setThumbnail(track.artworkUrl);
  } else if (fs.existsSync(fallbackCoverPath)) {
    const attachmentName = SONORA_BRAND.assets.discordCoverAttachmentName;
    files.push(new AttachmentBuilder(fallbackCoverPath, { name: attachmentName }));
    embed.setThumbnail(`attachment://${attachmentName}`);
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('sonora:toggle_pause')
      .setLabel(isPaused ? (isPt ? 'Retomar' : 'Resume') : isPt ? 'Pausa' : 'Pause')
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('sonora:skip')
      .setLabel(isPt ? 'Avançar' : 'Skip')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('sonora:stop')
      .setLabel(isPt ? 'Parar' : 'Stop')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('sonora:loop')
      .setLabel(`${isPt ? 'Loop' : 'Loop'}: ${loopLabelMap[state.loopMode]}`)
      .setStyle(state.loopMode === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('sonora:shuffle')
      .setLabel(isPt ? 'Aleatório' : 'Shuffle')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(state.queue.length < 2)
  );

  return {
    embeds: [embed],
    components: [row],
    files
  };
}

export function createSonoraHelpEmbed(locale: SupportedLocale): EmbedBuilder {
  const isPt = locale === 'pt-PT';

  return new EmbedBuilder()
    .setColor(SONORA_BRAND.colors.discordEmbedAccent)
    .setTitle(`♪ ${SONORA_BRAND.name} — ${t(locale, 'help.title')}`)
    .setDescription(t(locale, 'help.description'))
    .addFields(
      {
        name: isPt ? 'Reprodução' : 'Playback',
        value: isPt
          ? [
              '`/play <query>` — Toca música por nome/artista ou URL',
              '`/pause` — Coloca a reprodução em pausa',
              '`/resume` — Retoma a música em pausa',
              '`/skip` — Avança para a faixa seguinte',
              '`/stop` — Para a música e limpa a fila',
              '`/leave` — Desliga a Sonora do canal de voz',
              '`/volume <0-200>` — Ajusta o volume',
              '`/nowplaying` — Mostra a faixa atual e controlos'
            ].join('\n')
          : [
              '`/play <query>` — Play track by name/artist or URL',
              '`/pause` — Pause current playback',
              '`/resume` — Resume paused playback',
              '`/skip` — Skip to the next track',
              '`/stop` — Stop playback and clear queue',
              '`/leave` — Disconnect Sonora from voice channel',
              '`/volume <0-200>` — Adjust playback volume',
              '`/nowplaying` — Show current track and controls'
            ].join('\n')
      },
      {
        name: isPt ? 'Fila & Modos' : 'Queue & Modes',
        value: isPt
          ? [
              '`/queue [page]` — Lista as músicas na fila',
              '`/remove <position>` — Remove uma faixa da fila',
              '`/clear` — Limpa todas as faixas em espera',
              '`/shuffle` — Baralha a fila aleatoriamente',
              '`/loop <off|track|queue>` — Configura o modo de repetição'
            ].join('\n')
          : [
              '`/queue [page]` — List queued tracks',
              '`/remove <position>` — Remove a track from queue',
              '`/clear` — Clear all upcoming tracks',
              '`/shuffle` — Shuffle the queue randomly',
              '`/loop <off|track|queue>` — Set repeat mode'
            ].join('\n')
      },
      {
        name: isPt ? 'Letras & Sistema' : 'Lyrics & System',
        value: isPt
          ? [
              '`/lyrics [query]` — Apresenta a letra da música',
              '`/language <pt-PT|en>` — Altera o idioma no servidor',
              '`/help` — Mostra esta mensagem de ajuda'
            ].join('\n')
          : [
              '`/lyrics [query]` — Display song lyrics',
              '`/language <pt-PT|en>` — Change server language',
              '`/help` — Show this help message'
            ].join('\n')
      }
    )
    .setFooter({
      text: `${SONORA_BRAND.upperName} • ${SONORA_BRAND.tagline[locale]}`
    });
}

export function createSonoraQueueEmbed(
  state: PlayerStateSnapshot,
  page = 1,
  locale: SupportedLocale = 'pt-PT'
): EmbedBuilder {
  const isPt = locale === 'pt-PT';
  const pageSize = 10;
  const totalTracks = state.queue.length;
  const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const items = state.queue.slice(startIdx, startIdx + pageSize);

  const embed = new EmbedBuilder()
    .setColor(SONORA_BRAND.colors.discordEmbedAccent)
    .setTitle(
      isPt ? `♪ Fila de Reprodução — ${SONORA_BRAND.name}` : `♪ Playback Queue — ${SONORA_BRAND.name}`
    );

  const currentLine = state.currentTrack
    ? `**${state.currentTrack.title}** — ${state.currentTrack.artist} \`[${formatDuration(state.currentTrack.durationMs)}]\``
    : isPt
      ? '_Nenhuma faixa em reprodução_'
      : '_Nothing playing_';

  const queueLines =
    items.length > 0
      ? items
          .map(
            (track, i) =>
              `\`${startIdx + i + 1}.\` **${track.title}** — ${track.artist} \`[${formatDuration(track.durationMs)}]\`${
                track.requestedBy
                  ? ` • _${track.requestedBy.displayName ?? track.requestedBy.username}_`
                  : ''
              }`
          )
          .join('\n')
      : t(locale, 'common.error.emptyQueue');

  embed.setDescription(
    [
      isPt ? `**Agora a tocar:**\n${currentLine}` : `**Now Playing:**\n${currentLine}`,
      '',
      isPt ? `**Próximas na fila (${totalTracks}):**` : `**Up Next (${totalTracks}):**`,
      queueLines
    ].join('\n')
  );

  embed.setFooter({
    text: isPt
      ? `${SONORA_BRAND.upperName} • Página ${safePage}/${totalPages} • Volume: ${state.volume}% • Loop: ${state.loopMode}`
      : `${SONORA_BRAND.upperName} • Page ${safePage}/${totalPages} • Volume: ${state.volume}% • Loop: ${state.loopMode}`
  });

  return embed;
}
