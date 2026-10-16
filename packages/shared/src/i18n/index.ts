import type { SupportedLocale } from '../types.js';

export const TRANSLATIONS = {
  'pt-PT': {
    // Identidade e Geral
    'brand.welcome': 'Bem-vindo à Sonora — Bot de Música Discord & Leitor Web Premium.',
    'common.error.unexpected': 'Ocorreu um erro inesperado ao processar o teu pedido.',
    'common.error.invalidArgs': 'Os argumentos fornecidos são inválidos: {details}',
    'common.error.guildOnly': 'Este comando só pode ser utilizado dentro de um servidor Discord.',
    'common.error.voiceRequired': 'Tens de estar ligado a um canal de voz para utilizar este comando.',
    'common.error.sameVoiceRequired': 'Tens de estar no mesmo canal de voz que a Sonora ({channel}) para controlar a reprodução.',
    'common.error.djRequired': 'Apenas utilizadores com cargo de DJ ou Administradores podem executar esta operação.',
    'common.error.adminRequired': 'Apenas Administradores do servidor podem alterar esta configuração.',
    'common.error.nothingPlaying': 'Não existe nenhuma música em reprodução neste momento.',
    'common.error.emptyQueue': 'A fila de reprodução está atualmente vazia.',

    // Reprodução e Fila
    'player.searching': 'A procurar "{query}"...',
    'player.trackAdded': 'Adicionada à fila: **{title}** — {artist}',
    'player.nowPlaying': 'A reproduzir agora: **{title}** — {artist}',
    'player.paused': 'Reprodução colocada em pausa.',
    'player.alreadyPaused': 'A reprodução já se encontra em pausa.',
    'player.resumed': 'Reprodução retomada.',
    'player.alreadyPlaying': 'A música já está em reprodução.',
    'player.skipped': 'Avançaste para a faixa seguinte. A tocar: **{title}**',
    'player.skippedLast': 'Faixa ignorada. Não existem mais músicas na fila.',
    'player.stopped': 'Reprodução parada e fila limpa.',
    'player.leftVoice': 'A Sonora desligou-se do canal de voz.',
    'player.volumeChanged': 'Volume ajustado para **{volume}%**.',
    'player.volumeInvalid': 'O volume deve ser um valor inteiro entre 0 e 200.',
    'player.shuffled': 'A fila de reprodução ({count} faixas) foi baralhada aleatoriamente.',
    'player.loopChanged.off': 'Modo de repetição desativado.',
    'player.loopChanged.track': 'Modo de repetição ativado para a **faixa atual**.',
    'player.loopChanged.queue': 'Modo de repetição ativado para **toda a fila**.',
    'player.removedTrack': 'Removida da fila na posição #{position}: **{title}**.',
    'player.removeInvalidPosition': 'Posição inválida. Escolhe um número entre 1 e {max}.',
    'player.queueCleared': 'Foram removidas **{count}** faixas da fila de reprodução.',

    // Fontes, Spotify e SSRF
    'source.noMatch': 'Não foi encontrada nenhuma correspondência fiável para "{query}".',
    'source.spotifyMatched': 'Faixa identificada no Spotify (**{title}** — {artist}) e associada a uma fonte suportada.',
    'source.spotifyNoMatch': 'A faixa foi identificada no Spotify (**{title}** — {artist}), mas não foi encontrada uma correspondência fiável para reprodução.',
    'source.ssrfBlocked': 'O URL indicado foi bloqueado por motivos de segurança (apenas são permitidos endereços externos públicos via HTTPS).',

    // Letras
    'lyrics.notFound': 'Não foram encontradas letras disponíveis para **{title}** — {artist}.',
    'lyrics.restrictedWithLink': 'A letra completa não pode ser apresentada diretamente devido a restrições de direitos de autor. Consulta a fonte autorizada: {url}',
    'lyrics.footer': 'Fonte: {provider} • Direitos reservados aos respetivos autores e editoras.',

    // Idioma e Ajuda
    'language.changed': 'O idioma da Sonora foi alterado para **Português (Portugal)**.',
    'help.title': 'Comandos da Sonora',
    'help.description': 'Controla a reprodução no Discord ou através do Painel Web Sonora.',

    // Painel Web UI
    'web.nav.player': 'Leitor & Fila',
    'web.nav.search': 'Pesquisar',
    'web.nav.playlists': 'Playlists',
    'web.nav.favorites': 'Favoritos',
    'web.nav.history': 'Histórico',
    'web.nav.lyrics': 'Letras',
    'web.nav.settings': 'Configurações & DJ',
    'web.auth.loginDiscord': 'Entrar com o Discord',
    'web.auth.logout': 'Terminar Sessão',
    'web.status.connected': 'Ligado ao Discord',
    'web.status.disconnected': 'Desligado do canal de voz',
    'web.confirm.clearQueue': 'Tens a certeza de que pretendes limpar toda a fila de reprodução?',
    'web.confirm.deletePlaylist': 'Tens a certeza de que pretendes eliminar a playlist "{name}"?'
  },
  en: {
    // Identity & General
    'brand.welcome': 'Welcome to Sonora — Premium Discord Music Bot & Web Player.',
    'common.error.unexpected': 'An unexpected error occurred while processing your request.',
    'common.error.invalidArgs': 'The provided arguments are invalid: {details}',
    'common.error.guildOnly': 'This command can only be used inside a Discord server.',
    'common.error.voiceRequired': 'You must be connected to a voice channel to use this command.',
    'common.error.sameVoiceRequired': 'You must be in the same voice channel as Sonora ({channel}) to control playback.',
    'common.error.djRequired': 'Only users with a DJ role or Server Administrators can perform this action.',
    'common.error.adminRequired': 'Only Server Administrators can modify this setting.',
    'common.error.nothingPlaying': 'There is no music playing right now.',
    'common.error.emptyQueue': 'The playback queue is currently empty.',

    // Playback & Queue
    'player.searching': 'Searching for "{query}"...',
    'player.trackAdded': 'Added to queue: **{title}** — {artist}',
    'player.nowPlaying': 'Now playing: **{title}** — {artist}',
    'player.paused': 'Playback paused.',
    'player.alreadyPaused': 'Playback is already paused.',
    'player.resumed': 'Playback resumed.',
    'player.alreadyPlaying': 'The track is already playing.',
    'player.skipped': 'Skipped to the next track. Now playing: **{title}**',
    'player.skippedLast': 'Track skipped. No more tracks remaining in the queue.',
    'player.stopped': 'Playback stopped and queue cleared.',
    'player.leftVoice': 'Sonora disconnected from the voice channel.',
    'player.volumeChanged': 'Volume set to **{volume}%**.',
    'player.volumeInvalid': 'Volume must be an integer between 0 and 200.',
    'player.shuffled': 'The playback queue ({count} tracks) has been shuffled.',
    'player.loopChanged.off': 'Repeat mode disabled.',
    'player.loopChanged.track': 'Repeat mode enabled for the **current track**.',
    'player.loopChanged.queue': 'Repeat mode enabled for the **entire queue**.',
    'player.removedTrack': 'Removed track at position #{position}: **{title}**.',
    'player.removeInvalidPosition': 'Invalid position. Choose a number between 1 and {max}.',
    'player.queueCleared': 'Removed **{count}** tracks from the playback queue.',

    // Sources, Spotify & SSRF
    'source.noMatch': 'No reliable match was found for "{query}".',
    'source.spotifyMatched': 'Identified track on Spotify (**{title}** — {artist}) and matched to a supported playback source.',
    'source.spotifyNoMatch': 'Identified track on Spotify (**{title}** — {artist}), but no reliable playback match was found.',
    'source.ssrfBlocked': 'The provided URL was blocked for security reasons (only public external HTTPS addresses are allowed).',

    // Lyrics
    'lyrics.notFound': 'No lyrics found for **{title}** — {artist}.',
    'lyrics.restrictedWithLink': 'Full lyrics cannot be displayed directly due to copyright restrictions. View the authorized source: {url}',
    'lyrics.footer': 'Source: {provider} • All rights reserved to their respective owners and publishers.',

    // Language & Help
    'language.changed': 'Sonora language has been set to **English**.',
    'help.title': 'Sonora Commands',
    'help.description': 'Control playback directly on Discord or via the Sonora Web Player.',

    // Web Panel UI
    'web.nav.player': 'Player & Queue',
    'web.nav.search': 'Search',
    'web.nav.playlists': 'Playlists',
    'web.nav.favorites': 'Favorites',
    'web.nav.history': 'History',
    'web.nav.lyrics': 'Lyrics',
    'web.nav.settings': 'Settings & DJ',
    'web.auth.loginDiscord': 'Sign in with Discord',
    'web.auth.logout': 'Sign Out',
    'web.status.connected': 'Connected to Discord',
    'web.status.disconnected': 'Disconnected from voice channel',
    'web.confirm.clearQueue': 'Are you sure you want to clear the entire playback queue?',
    'web.confirm.deletePlaylist': 'Are you sure you want to delete the playlist "{name}"?'
  }
} as const;

export type TranslationKey = keyof (typeof TRANSLATIONS)['pt-PT'];

export function t(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const dictionary = TRANSLATIONS[locale] ?? TRANSLATIONS['pt-PT'];
  const template: string = dictionary[key] ?? TRANSLATIONS['pt-PT'][key] ?? key;

  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (_, token: string) => {
    const val = params[token];
    return val !== undefined ? String(val) : `{${token}}`;
  });
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs <= 0 || !Number.isFinite(durationMs)) {
    return '--:--';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}
