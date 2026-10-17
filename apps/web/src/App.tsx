import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Disc3,
  ExternalLink,
  Globe,
  Heart,
  History,
  ListMusic,
  LogOut,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Repeat,
  Repeat1,
  Search,
  Settings,
  Shield,
  Shuffle,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  Wifi
} from 'lucide-react';
import {
  formatDuration,
  SONORA_BRAND,
  t,
  type AuthenticatedUser,
  type DjRole,
  type FavoriteTrack,
  type GuildSettings,
  type LoopMode,
  type LyricsResult,
  type PlaybackHistoryEntry,
  type PlayerStateSnapshot,
  type Playlist,
  type SupportedLocale,
  type Track,
  type WebSocketEventMessage
} from '@sonora/shared';
import {
  SonoraApiClient,
  trackToPersistable,
  type HealthResponse,
  type PersistableTrackPayload
} from './api.js';

type ActiveTab = 'queue' | 'playlists' | 'favorites' | 'lyrics' | 'history' | 'settings';

const DEFAULT_PLAYER_STATE: PlayerStateSnapshot = {
  guildId: '000000000000000000',
  voiceChannelId: null,
  voiceChannelName: null,
  textChannelId: null,
  status: 'idle',
  currentTrack: null,
  queue: [],
  volume: 80,
  loopMode: 'off',
  shuffled: false,
  positionMs: 0,
  lastError: null,
  botConnected: false,
  updatedAt: new Date().toISOString()
};

export interface SonoraAppProps {
  apiClient?: SonoraApiClient;
  disableWebSocket?: boolean;
}

export function App({ apiClient, disableWebSocket = false }: SonoraAppProps) {
  const api = useMemo(() => apiClient ?? new SonoraApiClient(), [apiClient]);

  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [devLoginAvailable, setDevLoginAvailable] = useState(false);
  const [locale, setLocale] = useState<SupportedLocale>('pt-PT');

  const [playerState, setPlayerState] = useState<PlayerStateSnapshot>(DEFAULT_PLAYER_STATE);
  const [livePositionMs, setLivePositionMs] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('queue');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmittingPlay, setIsSubmittingPlay] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [favorites, setFavorites] = useState<FavoriteTrack[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null);

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [lyricsQuery, setLyricsQuery] = useState('');
  const [loadingLyrics, setLoadingLyrics] = useState(false);

  const [history, setHistory] = useState<PlaybackHistoryEntry[]>([]);
  const [guildSettings, setGuildSettings] = useState<GuildSettings | null>(null);
  const [djRoles, setDjRoles] = useState<DjRole[]>([]);
  const [availableRoles, setAvailableRoles] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [selectedRoleToAdd, setSelectedRoleToAdd] = useState('');

  const lastStateTimestampRef = useRef<number>(Date.now());

  const showNotice = useCallback((type: 'success' | 'error', message: string) => {
    setBanner({ type, message });
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [banner]);

  const loadAuthenticatedDashboard = useCallback(async () => {
    const [stateRes, favRes, plRes, histRes, setRes] = await Promise.all([
      api.getPlayerState(),
      api.getFavorites(),
      api.getPlaylists(),
      api.getHistory(),
      api.getSettings()
    ]);

    setPlayerState(stateRes);
    setLivePositionMs(stateRes.positionMs);
    lastStateTimestampRef.current = Date.now();
    setFavorites(favRes.favorites);
    setPlaylists(plRes.playlists);
    setHistory(histRes.history);
    setGuildSettings(setRes.settings);
    setDjRoles(setRes.djRoles);
    setAvailableRoles(setRes.availableRoles);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const healthData = await api.getHealth().catch(() => null);
        if (!cancelled && healthData) {
          setHealth(healthData);
          setOauthConfigured(healthData.oauthConfigured);
          setDevLoginAvailable(healthData.devLoginAvailable);
        }

        const meData = await api.getMe().catch(() => null);
        if (!cancelled && meData && meData.authenticated && meData.user) {
          if (meData.csrfToken) {
            api.setCsrfToken(meData.csrfToken);
          }
          setUser(meData.user);
          setLocale(meData.user.preferredLanguage || 'pt-PT');
          await loadAuthenticatedDashboard();
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, loadAuthenticatedDashboard]);

  // Atualização contínua da barra de progresso enquanto reproduz
  useEffect(() => {
    if (playerState.status !== 'playing' || !playerState.currentTrack) {
      setLivePositionMs(playerState.positionMs);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastStateTimestampRef.current;
      const nextPos = playerState.positionMs + elapsed;
      const maxDur = playerState.currentTrack?.durationMs;
      setLivePositionMs(maxDur ? Math.min(nextPos, maxDur) : nextPos);
    }, 500);

    return () => clearInterval(interval);
  }, [playerState]);

  // Ligação WebSocket em Tempo Real (/ws)
  useEffect(() => {
    if (!user || disableWebSocket || typeof WebSocket === 'undefined') {
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    const connectWs = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!unmounted) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WebSocketEventMessage;
          if (msg.type === 'player:state') {
            setPlayerState(msg.payload);
            setLivePositionMs(msg.payload.positionMs);
            lastStateTimestampRef.current = Date.now();
          } else if (msg.type === 'history:updated') {
            setHistory(msg.payload);
          } else if (msg.type === 'settings:updated') {
            setGuildSettings(msg.payload.settings);
            setDjRoles(msg.payload.djRoles);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setWsConnected(false);
        reconnectTimer = setTimeout(connectWs, 3000);
      };
    };

    connectWs();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [user, disableWebSocket]);

  const handleLanguageChange = async (nextLocale: SupportedLocale) => {
    setLocale(nextLocale);
    if (user) {
      try {
        await api.setUserLanguage(nextLocale);
        setUser({ ...user, preferredLanguage: nextLocale });
      } catch (err) {
        showNotice('error', err instanceof Error ? err.message : 'Erro ao alterar idioma');
      }
    }
  };

  const handleDevLogin = async () => {
    try {
      const res = await api.devLogin('Admin Sonora');
      setUser(res.user);
      setLocale(res.user.preferredLanguage || 'pt-PT');
      await loadAuthenticatedDashboard();
      showNotice(
        'success',
        locale === 'pt-PT'
          ? 'Sessão local iniciada com sucesso no Painel Sonora.'
          : 'Local session started in Sonora Web Player.'
      );
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Falha no login de desenvolvimento');
    }
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setWsConnected(false);
    }
  };

  const handlePlaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || isSubmittingPlay) return;
    setIsSubmittingPlay(true);
    try {
      const res = await api.play(searchQuery.trim());
      setPlayerState(res.state);
      setLivePositionMs(res.state.positionMs);
      lastStateTimestampRef.current = Date.now();
      const firstTrack = res.tracksAdded[0];
      if (firstTrack) {
        showNotice(
          'success',
          res.startedImmediately
            ? `${locale === 'pt-PT' ? 'A reproduzir agora' : 'Now playing'}: ${firstTrack.title} — ${firstTrack.artist}`
            : `${locale === 'pt-PT' ? 'Adicionada à fila' : 'Added to queue'}: ${firstTrack.title}`
        );
      }
      setSearchQuery('');
      const hist = await api.getHistory();
      setHistory(hist.history);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Não foi possível reproduzir a faixa');
    } finally {
      setIsSubmittingPlay(false);
    }
  };

  const handlePlayDirectQuery = async (query: string) => {
    try {
      const res = await api.play(query);
      setPlayerState(res.state);
      setLivePositionMs(res.state.positionMs);
      lastStateTimestampRef.current = Date.now();
      const firstTrack = res.tracksAdded[0];
      if (firstTrack) {
        showNotice(
          'success',
          `${locale === 'pt-PT' ? 'Faixa enviada para o Discord' : 'Track sent to Discord'}: ${firstTrack.title}`
        );
      }
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Falha ao reproduzir faixa');
    }
  };

  const handleTogglePause = async () => {
    try {
      const next =
        playerState.status === 'paused' ? await api.resume() : await api.pause();
      setPlayerState(next);
      setLivePositionMs(next.positionMs);
      lastStateTimestampRef.current = Date.now();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao alternar pausa');
    }
  };

  const handleSkip = async () => {
    try {
      const next = await api.skip();
      setPlayerState(next);
      setLivePositionMs(next.positionMs);
      lastStateTimestampRef.current = Date.now();
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao avançar faixa');
    }
  };

  const handleStop = async () => {
    try {
      const next = await api.stop();
      setPlayerState(next);
      setLivePositionMs(0);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao parar reprodução');
    }
  };

  const handleLeave = async () => {
    try {
      const next = await api.leave();
      setPlayerState(next);
      setLivePositionMs(0);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao desligar do canal de voz');
    }
  };

  const handleCycleLoop = async () => {
    const order: LoopMode[] = ['off', 'track', 'queue'];
    const nextMode = order[(order.indexOf(playerState.loopMode) + 1) % order.length];
    try {
      const next = await api.setLoop(nextMode);
      setPlayerState(next);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao alterar modo de repetição');
    }
  };

  const handleShuffle = async () => {
    try {
      const next = await api.shuffle();
      setPlayerState(next);
      showNotice('success', locale === 'pt-PT' ? 'Fila baralhada!' : 'Queue shuffled!');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao baralhar fila');
    }
  };

  const handleClearQueue = async () => {
    try {
      const next = await api.clearQueue();
      setPlayerState(next);
      showNotice('success', locale === 'pt-PT' ? 'Fila limpa com sucesso.' : 'Queue cleared.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao limpar fila');
    }
  };

  const handleRemoveFromQueue = async (position: number) => {
    try {
      const res = await api.removeQueuePosition(position);
      setPlayerState(res.state);
      showNotice(
        'success',
        `${locale === 'pt-PT' ? 'Removida da fila' : 'Removed from queue'}: ${res.removed.title}`
      );
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao remover faixa da fila');
    }
  };

  const handleVolumeChange = async (volume: number) => {
    setPlayerState((prev) => ({ ...prev, volume }));
    try {
      const next = await api.setVolume(volume);
      setPlayerState(next);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao ajustar volume');
    }
  };

  const isTrackFavorited = useCallback(
    (trackId: string) => favorites.some((f) => f.trackId === trackId),
    [favorites]
  );

  const handleToggleFavorite = async (track: PersistableTrackPayload) => {
    try {
      if (isTrackFavorited(track.id)) {
        await api.removeFavorite(track.id);
        setFavorites((prev) => prev.filter((f) => f.trackId !== track.id));
        showNotice('success', locale === 'pt-PT' ? 'Removida dos favoritos.' : 'Removed from favorites.');
      } else {
        const res = await api.addFavorite(track);
        setFavorites((prev) => [res.item, ...prev.filter((f) => f.trackId !== track.id)]);
        showNotice('success', locale === 'pt-PT' ? 'Guardada nos favoritos!' : 'Saved to favorites!');
      }
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao atualizar favoritos');
    }
  };

  const handleCreatePlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    try {
      const res = await api.createPlaylist(newPlaylistName.trim(), newPlaylistDesc.trim());
      setPlaylists((prev) => [res.playlist, ...prev]);
      setSelectedPlaylist(res.playlist);
      setNewPlaylistName('');
      setNewPlaylistDesc('');
      showNotice('success', locale === 'pt-PT' ? 'Playlist criada com sucesso!' : 'Playlist created!');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao criar playlist');
    }
  };

  const handleSelectPlaylist = async (playlistId: number) => {
    try {
      const res = await api.getPlaylistById(playlistId);
      setSelectedPlaylist(res.playlist);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao abrir playlist');
    }
  };

  const handleConfirmDeletePlaylist = async () => {
    if (!playlistToDelete) return;
    try {
      await api.deletePlaylist(playlistToDelete.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistToDelete.id));
      if (selectedPlaylist?.id === playlistToDelete.id) {
        setSelectedPlaylist(null);
      }
      setPlaylistToDelete(null);
      showNotice('success', locale === 'pt-PT' ? 'Playlist eliminada.' : 'Playlist deleted.');
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao eliminar playlist');
    }
  };

  const handleAddTrackToPlaylist = async (playlistId: number, track: PersistableTrackPayload) => {
    try {
      const res = await api.addTrackToPlaylist(playlistId, track);
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? { ...p, trackCount: res.playlist.trackCount } : p))
      );
      if (selectedPlaylist?.id === playlistId) {
        setSelectedPlaylist(res.playlist);
      }
      showNotice(
        'success',
        `${locale === 'pt-PT' ? 'Adicionada à playlist' : 'Added to playlist'}: ${res.playlist.name}`
      );
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao adicionar à playlist');
    }
  };

  const handleRemovePlaylistTrack = async (playlistId: number, itemId: number) => {
    try {
      const res = await api.removeTrackFromPlaylist(playlistId, itemId);
      setSelectedPlaylist(res.playlist);
      setPlaylists((prev) =>
        prev.map((p) => (p.id === playlistId ? { ...p, trackCount: res.playlist.trackCount } : p))
      );
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao remover faixa da playlist');
    }
  };

  const handlePlayEntirePlaylist = async (playlistId: number) => {
    try {
      const res = await api.playPlaylist(playlistId);
      setPlayerState(res.state);
      showNotice(
        'success',
        locale === 'pt-PT'
          ? `${res.queuedCount} faixas da playlist enviadas para a fila!`
          : `${res.queuedCount} playlist tracks queued!`
      );
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Erro ao reproduzir playlist');
    }
  };

  const handleFetchLyrics = async (customQuery?: string) => {
    setLoadingLyrics(true);
    try {
      const res = await api.getLyrics(customQuery?.trim() || undefined);
      setLyrics(res.lyrics);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Letra não encontrada');
      setLyrics(null);
    } finally {
      setLoadingLyrics(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'lyrics' && playerState.currentTrack && !lyrics) {
      void handleFetchLyrics();
    }
  }, [activeTab, playerState.currentTrack?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#090A0C] text-[#F8FAFC] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <img
            src={SONORA_BRAND.assets.symbolDark}
            alt="Sonora"
            className="w-16 h-16 animate-pulse"
          />
          <p className="text-sm text-[#94A3B8] font-medium">A carregar estúdio Sonora...</p>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // Ecrã de Autenticação (Login Discord OAuth2 + Acesso Local Dev)
  // ===========================================================================
  if (!user) {
    return (
      <div className="min-h-screen bg-[#090A0C] text-[#F8FAFC] flex flex-col justify-between p-6 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[640px] h-[340px] rounded-full bg-[#10B981]/10 blur-[130px]" />

        <header className="max-w-6xl w-full mx-auto flex items-center justify-between z-10">
          <img
            src={SONORA_BRAND.assets.horizontalDark}
            alt="Sonora"
            className="h-11 w-auto"
          />
          <div className="flex items-center gap-2 bg-[#12151B] border border-white/10 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setLocale('pt-PT')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                locale === 'pt-PT'
                  ? 'bg-[#10B981] text-[#06281E]'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              PT-PT
            </button>
            <button
              type="button"
              onClick={() => setLocale('en')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                locale === 'en'
                  ? 'bg-[#10B981] text-[#06281E]'
                  : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </header>

        <main className="max-w-lg w-full mx-auto my-auto z-10">
          <div className="bg-[#12151B] border border-white/10 rounded-3xl p-8 shadow-2xl space-y-6">
            <div className="flex items-center gap-4">
              <img
                src={SONORA_BRAND.assets.symbolDark}
                alt="Sonora Symbol"
                className="w-14 h-14 rounded-2xl shadow-lg"
              />
              <div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30">
                  <Sparkles className="w-3.5 h-3.5" />
                  {SONORA_BRAND.name} Studio
                </span>
                <h1 className="text-2xl font-bold mt-1 tracking-tight text-white">
                  {t(locale, 'brand.welcome')}
                </h1>
              </div>
            </div>

            <p className="text-sm text-[#94A3B8] leading-relaxed">
              {locale === 'pt-PT'
                ? 'Controla a reprodução de áudio em tempo real no teu servidor Discord, gere filas partilhadas, cria playlists pessoais, consulta letras sincronizadas e ajusta permissões de DJ.'
                : 'Control real-time audio playback in your Discord server, manage shared queues, build personal playlists, view synced lyrics, and configure DJ permissions.'}
            </p>

            {health && (
              <div className="bg-[#181C24] border border-white/5 rounded-2xl p-4 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      health.botReady ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'
                    }`}
                  />
                  <span className="text-[#F8FAFC] font-medium">
                    {health.guildName || 'Servidor Discord'}
                  </span>
                </div>
                <span className="text-[#94A3B8] font-mono-code">
                  {health.botTag ?? (health.botReady ? 'Bot Online' : 'Modo Local')}
                </span>
              </div>
            )}

            {banner && (
              <div
                className={`p-3.5 rounded-xl text-xs font-medium border ${
                  banner.type === 'error'
                    ? 'bg-[#EF4444]/15 border-[#EF4444]/40 text-red-200'
                    : 'bg-[#22C55E]/15 border-[#22C55E]/40 text-emerald-200'
                }`}
              >
                {banner.message}
              </div>
            )}

            <div className="space-y-3 pt-2">
              <a
                href="/api/auth/login"
                className="w-full flex items-center justify-center gap-3 py-3.5 px-5 rounded-xl font-semibold text-sm bg-[#10B981] hover:bg-[#34D399] text-[#052018] transition shadow-lg shadow-[#10B981]/20"
              >
                <Radio className="w-4 h-4" />
                {t(locale, 'web.auth.loginDiscord')}
              </a>

              {devLoginAvailable && (
                <button
                  type="button"
                  onClick={handleDevLogin}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-xs bg-[#181C24] hover:bg-white/10 text-[#F8FAFC] border border-white/10 transition cursor-pointer"
                >
                  <Shield className="w-4 h-4 text-[#34D399]" />
                  {locale === 'pt-PT'
                    ? 'Acesso Rápido Local (Administrador no PC)'
                    : 'Quick Local Dev Login (PC Admin)'}
                </button>
              )}

              {!oauthConfigured && (
                <p className="text-[11px] text-[#94A3B8] text-center pt-1">
                  {locale === 'pt-PT'
                    ? 'Dica: Para login OAuth2 remoto com amigos, define DISCORD_CLIENT_SECRET no ficheiro .env.'
                    : 'Tip: Set DISCORD_CLIENT_SECRET in .env to enable remote Discord OAuth2 login.'}
                </p>
              )}
            </div>
          </div>
        </main>

        <footer className="max-w-6xl w-full mx-auto text-center text-xs text-[#94A3B8]/70 z-10">
          {SONORA_BRAND.name} • YouTube • SoundCloud • Spotify Match • Direct HTTPS Audio
        </footer>
      </div>
    );
  }

  // ===========================================================================
  // Painel Principal Autenticado da Sonora
  // ===========================================================================
  const currentTrack: Track | null = playerState.currentTrack;
  const progressPercent =
    currentTrack && currentTrack.durationMs && currentTrack.durationMs > 0
      ? Math.min(100, Math.round((livePositionMs / currentTrack.durationMs) * 100))
      : 0;

  return (
    <div className="min-h-screen bg-[#090A0C] text-[#F8FAFC] flex flex-col">
      {/* Barra de Topo Sonora */}
      <header className="sticky top-0 z-30 bg-[#090A0C]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <img
              src={SONORA_BRAND.assets.horizontalDark}
              alt="Sonora"
              className="h-9 sm:h-10 w-auto"
            />
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[#12151B] border border-white/10 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  playerState.voiceChannelId ? 'bg-[#10B981] animate-pulse' : 'bg-[#94A3B8]'
                }`}
              />
              <span className="text-[#F8FAFC] font-medium">
                {playerState.voiceChannelName
                  ? `${t(locale, 'web.status.connected')}: #${playerState.voiceChannelName}`
                  : t(locale, 'web.status.disconnected')}
              </span>
            </div>
            <div className="hidden lg:flex items-center gap-1.5 text-xs text-[#94A3B8]">
              <Wifi className={`w-3.5 h-3.5 ${wsConnected ? 'text-[#10B981]' : 'text-[#94A3B8]'}`} />
              <span>{wsConnected ? 'Live Sync' : 'HTTP Sync'}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Seletor de Idioma */}
            <div className="flex items-center bg-[#12151B] border border-white/10 rounded-xl p-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleLanguageChange('pt-PT')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  locale === 'pt-PT'
                    ? 'bg-[#10B981] text-[#052018]'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                PT
              </button>
              <button
                type="button"
                onClick={() => handleLanguageChange('en')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
                  locale === 'en'
                    ? 'bg-[#10B981] text-[#052018]'
                    : 'text-[#94A3B8] hover:text-white'
                }`}
              >
                EN
              </button>
            </div>

            {/* Perfil do Utilizador */}
            <div className="flex items-center gap-2.5 bg-[#12151B] border border-white/10 rounded-xl px-3 py-1.5">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="w-6 h-6 rounded-full object-cover"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-[#10B981]/20 text-[#34D399] flex items-center justify-center text-xs font-bold">
                  {user.displayName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:block text-left">
                <p className="text-xs font-semibold text-white leading-none">{user.displayName}</p>
                <p className="text-[10px] text-[#34D399] font-medium mt-0.5">
                  {user.isAdmin ? 'Admin' : user.isDj ? 'DJ' : 'Membro'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title={t(locale, 'web.auth.logout')}
                className="ml-1 p-1 text-[#94A3B8] hover:text-[#EF4444] transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6">
        {/* Barra de Pesquisa e Reprodução Universal */}
        <form onSubmit={handlePlaySubmit} className="relative">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  locale === 'pt-PT'
                    ? 'Pesquisar música ou colar link (YouTube, SoundCloud, Spotify ou HTTPS)...'
                    : 'Search song or paste link (YouTube, SoundCloud, Spotify or HTTPS)...'
                }
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-[#12151B] border border-white/10 text-sm text-white placeholder-[#94A3B8] focus:outline-none focus:border-[#10B981]"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmittingPlay || !searchQuery.trim()}
              className="px-6 py-3.5 rounded-2xl font-semibold text-sm bg-[#10B981] hover:bg-[#34D399] disabled:opacity-50 text-[#052018] transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#10B981]/15"
            >
              <Play className="w-4 h-4 fill-current" />
              {isSubmittingPlay
                ? locale === 'pt-PT'
                  ? 'A processar...'
                  : 'Loading...'
                : locale === 'pt-PT'
                  ? 'Reproduzir no Discord'
                  : 'Play in Discord'}
            </button>
          </div>
        </form>

        {/* Notificação / Banner */}
        {banner && (
          <div
            className={`px-4 py-3 rounded-2xl text-xs font-medium flex items-center justify-between border ${
              banner.type === 'error'
                ? 'bg-[#EF4444]/15 border-[#EF4444]/40 text-red-200'
                : 'bg-[#10B981]/15 border-[#10B981]/40 text-[#34D399]'
            }`}
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {banner.message}
            </span>
            <button
              type="button"
              onClick={() => setBanner(null)}
              className="text-xs underline opacity-80 hover:opacity-100"
            >
              OK
            </button>
          </div>
        )}

        {/* Grelha Principal: Leitor Em Reprodução (Esquerda) + Abas de Gestão (Direita) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Cartão Now Playing (5 Colunas) */}
          <section className="lg:col-span-5 bg-[#12151B] border border-white/10 rounded-3xl p-6 flex flex-col justify-between space-y-6 shadow-xl">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#34D399] flex items-center gap-2">
                  <Disc3
                    className={`w-4 h-4 ${
                      playerState.status === 'playing' ? 'animate-spin' : ''
                    }`}
                  />
                  {locale === 'pt-PT' ? 'Em Reprodução' : 'Now Playing'}
                </span>

                {currentTrack && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#181C24] border border-white/10 text-[#94A3B8]">
                    {currentTrack.matchedFromSpotifyUrl
                      ? `Spotify → ${currentTrack.source.toUpperCase()}`
                      : currentTrack.source.toUpperCase()}
                  </span>
                )}
              </div>

              {/* Capa do Álbum com Fallback Oficial Sonora */}
              <div className="relative aspect-square w-full max-w-[300px] mx-auto rounded-2xl overflow-hidden bg-[#181C24] border border-white/10 shadow-2xl">
                <img
                  src={currentTrack?.artworkUrl || SONORA_BRAND.assets.coverFallbackSvg}
                  alt={currentTrack?.title || 'Sonora Cover'}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.src.endsWith(SONORA_BRAND.assets.coverFallbackSvg)) {
                      target.src = SONORA_BRAND.assets.coverFallbackSvg;
                    }
                  }}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Detalhes da Faixa Atual */}
              {currentTrack ? (
                <div className="text-center space-y-1.5">
                  <h2 className="text-xl font-bold text-white line-clamp-1">
                    {currentTrack.title}
                  </h2>
                  <p className="text-sm text-[#94A3B8] font-medium line-clamp-1">
                    {currentTrack.artist}
                  </p>
                  <p className="text-xs text-[#94A3B8]/80">
                    {locale === 'pt-PT' ? 'Pedido por' : 'Requested by'}:{' '}
                    <span className="text-[#34D399] font-medium">
                      {currentTrack.requestedBy?.displayName ||
                        currentTrack.requestedBy?.username ||
                        'Discord'}
                    </span>
                  </p>
                </div>
              ) : (
                <div className="text-center py-4 space-y-1">
                  <h2 className="text-base font-semibold text-white">
                    {t(locale, 'common.error.nothingPlaying')}
                  </h2>
                  <p className="text-xs text-[#94A3B8]">
                    {locale === 'pt-PT'
                      ? 'Usa a barra de pesquisa acima ou o comando /play no Discord.'
                      : 'Use the search bar above or /play in Discord.'}
                  </p>
                </div>
              )}

              {/* Barra de Progresso e Tempos */}
              <div className="space-y-2">
                <div className="w-full h-2 rounded-full bg-[#181C24] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#10B981] to-[#34D399] transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs font-mono-code text-[#94A3B8]">
                  <span>{formatDuration(livePositionMs)}</span>
                  <span>{formatDuration(currentTrack?.durationMs ?? null)}</span>
                </div>
              </div>
            </div>

            {/* Controlos de Transporte do Leitor */}
            <div className="space-y-5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleShuffle}
                  title="Shuffle"
                  className="p-2.5 rounded-xl bg-[#181C24] hover:bg-white/10 text-[#94A3B8] hover:text-white transition cursor-pointer"
                >
                  <Shuffle className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleTogglePause}
                  disabled={!currentTrack}
                  title={playerState.status === 'paused' ? 'Resume' : 'Pause'}
                  className="p-4 rounded-2xl bg-[#10B981] hover:bg-[#34D399] disabled:opacity-40 text-[#052018] transition shadow-lg shadow-[#10B981]/20 cursor-pointer"
                >
                  {playerState.status === 'paused' ? (
                    <Play className="w-5 h-5 fill-current" />
                  ) : (
                    <Pause className="w-5 h-5 fill-current" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={!currentTrack}
                  title="Skip"
                  className="p-2.5 rounded-xl bg-[#181C24] hover:bg-white/10 disabled:opacity-40 text-white transition cursor-pointer"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!currentTrack && playerState.queue.length === 0}
                  title="Stop"
                  className="p-2.5 rounded-xl bg-[#181C24] hover:bg-[#EF4444]/20 disabled:opacity-40 text-[#94A3B8] hover:text-[#EF4444] transition cursor-pointer"
                >
                  <Square className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleCycleLoop}
                  title={`Loop: ${playerState.loopMode}`}
                  className={`p-2.5 rounded-xl border transition cursor-pointer ${
                    playerState.loopMode !== 'off'
                      ? 'bg-[#10B981]/20 border-[#10B981] text-[#34D399]'
                      : 'bg-[#181C24] border-transparent text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {playerState.loopMode === 'track' ? (
                    <Repeat1 className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Controlo de Volume (0% a 200%) */}
              <div className="flex items-center gap-3 bg-[#181C24] px-4 py-2.5 rounded-2xl">
                <Volume2 className="w-4 h-4 text-[#34D399] shrink-0" />
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={playerState.volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-full accent-[#10B981] cursor-pointer"
                />
                <span className="text-xs font-mono-code text-white w-11 text-right">
                  {playerState.volume}%
                </span>
              </div>

              {/* Ações Rápidas da Faixa Atual */}
              <div className="flex items-center justify-between gap-2 text-xs">
                {currentTrack && (
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(trackToPersistable(currentTrack))}
                    className={`flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 font-medium transition cursor-pointer ${
                      isTrackFavorited(currentTrack.id)
                        ? 'bg-[#10B981]/15 border-[#10B981]/40 text-[#34D399]'
                        : 'bg-[#181C24] border-white/5 text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        isTrackFavorited(currentTrack.id) ? 'fill-current' : ''
                      }`}
                    />
                    {isTrackFavorited(currentTrack.id)
                      ? locale === 'pt-PT'
                        ? 'Nos Favoritos'
                        : 'Favorited'
                      : locale === 'pt-PT'
                        ? 'Guardar Favorito'
                        : 'Save Favorite'}
                  </button>
                )}

                {playerState.voiceChannelId && (
                  <button
                    type="button"
                    onClick={handleLeave}
                    className="py-2 px-3 rounded-xl bg-[#181C24] hover:bg-[#EF4444]/20 text-[#94A3B8] hover:text-[#EF4444] transition cursor-pointer"
                  >
                    {locale === 'pt-PT' ? 'Sair da Call' : 'Leave Voice'}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Painel Direito com Navegação por Abas (7 Colunas) */}
          <section className="lg:col-span-7 bg-[#12151B] border border-white/10 rounded-3xl p-6 flex flex-col shadow-xl min-h-[540px]">
            {/* Barra de Abas */}
            <div className="flex flex-wrap items-center gap-1.5 pb-4 border-b border-white/10">
              {(
                [
                  { id: 'queue', icon: ListMusic, label: `${t(locale, 'web.nav.player')} (${playerState.queue.length})` },
                  { id: 'playlists', icon: Music2, label: `${t(locale, 'web.nav.playlists')} (${playlists.length})` },
                  { id: 'favorites', icon: Heart, label: `${t(locale, 'web.nav.favorites')} (${favorites.length})` },
                  { id: 'lyrics', icon: Mic2, label: t(locale, 'web.nav.lyrics') },
                  { id: 'history', icon: History, label: t(locale, 'web.nav.history') },
                  { id: 'settings', icon: Settings, label: t(locale, 'web.nav.settings') }
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      isActive
                        ? 'bg-[#10B981] text-[#052018]'
                        : 'bg-[#181C24] text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* 1. ABA: FILA DE REPRODUÇÃO */}
            {activeTab === 'queue' && (
              <div className="flex-1 flex flex-col pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">
                    {locale === 'pt-PT' ? 'Fila de Reprodução Partilhada' : 'Shared Playback Queue'}
                  </h3>
                  {playerState.queue.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleShuffle}
                        className="px-3 py-1.5 rounded-xl bg-[#181C24] hover:bg-white/10 text-xs text-[#F8FAFC] transition cursor-pointer"
                      >
                        {locale === 'pt-PT' ? 'Baralhar' : 'Shuffle'}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearQueue}
                        className="px-3 py-1.5 rounded-xl bg-[#EF4444]/15 hover:bg-[#EF4444]/25 text-xs text-red-300 transition cursor-pointer"
                      >
                        {locale === 'pt-PT' ? 'Limpar Fila' : 'Clear Queue'}
                      </button>
                    </div>
                  )}
                </div>

                {playerState.queue.length === 0 ? (
                  <div className="my-auto text-center py-12 space-y-2">
                    <ListMusic className="w-10 h-10 text-[#94A3B8]/40 mx-auto" />
                    <p className="text-sm text-[#94A3B8]">{t(locale, 'common.error.emptyQueue')}</p>
                  </div>
                ) : (
                  <div className="space-y-2 overflow-y-auto max-h-[420px] pr-1">
                    {playerState.queue.map((track, idx) => (
                      <div
                        key={`${track.id}-${idx}`}
                        className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#181C24] border border-white/5 hover:border-white/15 transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs font-mono-code text-[#94A3B8] w-6 text-center">
                            #{idx + 1}
                          </span>
                          <img
                            src={track.artworkUrl || SONORA_BRAND.assets.coverFallbackSvg}
                            alt={track.title}
                            className="w-10 h-10 rounded-xl object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white truncate">
                              {track.title}
                            </p>
                            <p className="text-[11px] text-[#94A3B8] truncate">
                              {track.artist} • {formatDuration(track.durationMs)}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleToggleFavorite(trackToPersistable(track))}
                            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#34D399] transition cursor-pointer"
                            title="Favorito"
                          >
                            <Heart
                              className={`w-4 h-4 ${
                                isTrackFavorited(track.id) ? 'fill-[#10B981] text-[#10B981]' : ''
                              }`}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFromQueue(idx + 1)}
                            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#EF4444] transition cursor-pointer"
                            title="Remover da fila"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. ABA: PLAYLISTS PESSOAIS */}
            {activeTab === 'playlists' && (
              <div className="flex-1 flex flex-col pt-4 space-y-4">
                <form
                  onSubmit={handleCreatePlaylist}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-[#181C24] p-3 rounded-2xl border border-white/5"
                >
                  <input
                    type="text"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    placeholder={
                      locale === 'pt-PT' ? 'Nome da nova playlist...' : 'New playlist name...'
                    }
                    className="sm:col-span-5 px-3 py-2 rounded-xl bg-[#12151B] border border-white/10 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={newPlaylistDesc}
                    onChange={(e) => setNewPlaylistDesc(e.target.value)}
                    placeholder={
                      locale === 'pt-PT' ? 'Descrição opcional...' : 'Optional description...'
                    }
                    className="sm:col-span-5 px-3 py-2 rounded-xl bg-[#12151B] border border-white/10 text-xs text-white"
                  />
                  <button
                    type="submit"
                    className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#10B981] hover:bg-[#34D399] text-[#052018] font-semibold text-xs flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {locale === 'pt-PT' ? 'Criar' : 'Create'}
                  </button>
                </form>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1">
                  {/* Lista de Playlists */}
                  <div className="md:col-span-5 space-y-2 max-h-[360px] overflow-y-auto pr-1">
                    {playlists.length === 0 ? (
                      <p className="text-xs text-[#94A3B8] py-8 text-center">
                        {locale === 'pt-PT'
                          ? 'Ainda não criaste playlists pessoais.'
                          : 'No personal playlists yet.'}
                      </p>
                    ) : (
                      playlists.map((pl) => (
                        <div
                          key={pl.id}
                          onClick={() => handleSelectPlaylist(pl.id)}
                          className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between ${
                            selectedPlaylist?.id === pl.id
                              ? 'bg-[#10B981]/15 border-[#10B981]'
                              : 'bg-[#181C24] border-white/5 hover:border-white/15'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">{pl.name}</p>
                            <p className="text-[11px] text-[#94A3B8]">
                              {pl.trackCount} {locale === 'pt-PT' ? 'faixas' : 'tracks'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handlePlayEntirePlaylist(pl.id);
                              }}
                              title="Reproduzir Playlist"
                              className="p-1.5 rounded-lg bg-[#10B981] text-[#052018] hover:bg-[#34D399]"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPlaylistToDelete(pl);
                              }}
                              title="Eliminar Playlist"
                              className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#EF4444]"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Detalhe da Playlist Selecionada */}
                  <div className="md:col-span-7 bg-[#181C24] rounded-2xl p-4 border border-white/5 flex flex-col justify-between">
                    {selectedPlaylist ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                          <div>
                            <h4 className="text-sm font-bold text-white">
                              {selectedPlaylist.name}
                            </h4>
                            {selectedPlaylist.description && (
                              <p className="text-xs text-[#94A3B8]">
                                {selectedPlaylist.description}
                              </p>
                            )}
                          </div>
                          {currentTrack && (
                            <button
                              type="button"
                              onClick={() =>
                                handleAddTrackToPlaylist(
                                  selectedPlaylist.id,
                                  trackToPersistable(currentTrack)
                                )
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-[#10B981]/20 border border-[#10B981]/40 text-[#34D399] text-xs font-medium cursor-pointer"
                            >
                              + {locale === 'pt-PT' ? 'Guardar Faixa Atual' : 'Add Current Track'}
                            </button>
                          )}
                        </div>

                        <div className="space-y-2 max-h-[270px] overflow-y-auto">
                          {!selectedPlaylist.tracks || selectedPlaylist.tracks.length === 0 ? (
                            <p className="text-xs text-[#94A3B8] py-8 text-center">
                              {locale === 'pt-PT'
                                ? 'Esta playlist está vazia. Guarda a faixa atual ou favoritas!'
                                : 'This playlist is empty.'}
                            </p>
                          ) : (
                            selectedPlaylist.tracks.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[#12151B] text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-white truncate">{item.title}</p>
                                  <p className="text-[11px] text-[#94A3B8] truncate">
                                    {item.artist}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handlePlayDirectQuery(item.sourceUrl)}
                                    className="p-1.5 text-[#34D399] hover:bg-white/5 rounded-lg"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleRemovePlaylistTrack(selectedPlaylist.id, item.id)
                                    }
                                    className="p-1.5 text-[#94A3B8] hover:text-[#EF4444] rounded-lg"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#94A3B8] my-auto text-center py-12">
                        {locale === 'pt-PT'
                          ? 'Seleciona uma playlist à esquerda para ver ou gerir as faixas guardadas.'
                          : 'Select a playlist on the left to manage saved tracks.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3. ABA: FAVORITOS PESSOAIS */}
            {activeTab === 'favorites' && (
              <div className="flex-1 pt-4 space-y-2 overflow-y-auto max-h-[430px]">
                {favorites.length === 0 ? (
                  <p className="text-sm text-[#94A3B8] text-center py-14">
                    {locale === 'pt-PT'
                      ? 'Ainda não guardaste músicas nos teus Favoritos.'
                      : 'You have not saved any favorite tracks yet.'}
                  </p>
                ) : (
                  favorites.map((fav) => (
                    <div
                      key={fav.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#181C24] border border-white/5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={fav.artworkUrl || SONORA_BRAND.assets.coverFallbackSvg}
                          alt={fav.title}
                          className="w-10 h-10 rounded-xl object-cover shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{fav.title}</p>
                          <p className="text-[11px] text-[#94A3B8] truncate">
                            {fav.artist} • {formatDuration(fav.durationMs)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {selectedPlaylist && (
                          <button
                            type="button"
                            onClick={() =>
                              handleAddTrackToPlaylist(selectedPlaylist.id, {
                                id: fav.trackId,
                                title: fav.title,
                                artist: fav.artist,
                                durationMs: fav.durationMs,
                                artworkUrl: fav.artworkUrl,
                                source: fav.source,
                                sourceUrl: fav.sourceUrl
                              })
                            }
                            className="px-2 py-1 rounded-lg bg-[#12151B] text-[11px] text-[#34D399] hover:bg-white/10"
                          >
                            + {selectedPlaylist.name}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handlePlayDirectQuery(fav.sourceUrl)}
                          className="p-2 rounded-xl bg-[#10B981] text-[#052018] hover:bg-[#34D399] cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleToggleFavorite({
                              id: fav.trackId,
                              title: fav.title,
                              artist: fav.artist,
                              durationMs: fav.durationMs,
                              artworkUrl: fav.artworkUrl,
                              source: fav.source,
                              sourceUrl: fav.sourceUrl
                            })
                          }
                          className="p-2 rounded-xl text-[#94A3B8] hover:text-[#EF4444] cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* 4. ABA: LETRAS (LRCLIB + GENIUS) */}
            {activeTab === 'lyrics' && (
              <div className="flex-1 pt-4 flex flex-col space-y-4">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={lyricsQuery}
                    onChange={(e) => setLyricsQuery(e.target.value)}
                    placeholder={
                      locale === 'pt-PT'
                        ? 'Pesquisar letra de outra música (ou deixa em branco para a faixa atual)...'
                        : 'Search lyrics for another song...'
                    }
                    className="flex-1 px-3.5 py-2 rounded-xl bg-[#181C24] border border-white/10 text-xs text-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleFetchLyrics(lyricsQuery)}
                    disabled={loadingLyrics}
                    className="px-4 py-2 rounded-xl bg-[#10B981] text-[#052018] text-xs font-semibold cursor-pointer"
                  >
                    {loadingLyrics ? '...' : locale === 'pt-PT' ? 'Obter Letra' : 'Get Lyrics'}
                  </button>
                </div>

                {lyrics ? (
                  <div className="bg-[#181C24] rounded-2xl p-4 border border-white/5 flex-1 flex flex-col justify-between space-y-3">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <div>
                        <h4 className="text-sm font-bold text-white">{lyrics.trackTitle}</h4>
                        <p className="text-xs text-[#94A3B8]">
                          {lyrics.artistName} • Fonte: {lyrics.provider.toUpperCase()}
                        </p>
                      </div>
                      {lyrics.externalUrl && (
                        <a
                          href={lyrics.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-[#34D399] hover:underline"
                        >
                          Genius <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                    <pre className="text-xs text-[#F8FAFC] whitespace-pre-wrap font-sans leading-relaxed max-h-[320px] overflow-y-auto pr-2">
                      {lyrics.plainLyrics ||
                        (locale === 'pt-PT'
                          ? 'Letra direta indisponível. Consulta a ligação Genius acima.'
                          : 'Direct lyrics unavailable. Check the Genius link above.')}
                    </pre>
                  </div>
                ) : (
                  <p className="text-xs text-[#94A3B8] text-center my-auto py-12">
                    {locale === 'pt-PT'
                      ? 'Clica em "Obter Letra" para procurar a letra da música em reprodução.'
                      : 'Click "Get Lyrics" to fetch lyrics for the current track.'}
                  </p>
                )}
              </div>
            )}

            {/* 5. ABA: HISTÓRICO DO SERVIDOR */}
            {activeTab === 'history' && (
              <div className="flex-1 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
                    {t(locale, 'web.nav.history')}
                  </h4>
                  {user.isAdmin && history.length > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await api.clearHistory();
                        setHistory([]);
                      }}
                      className="text-xs text-red-300 hover:underline cursor-pointer"
                    >
                      {locale === 'pt-PT' ? 'Limpar Histórico' : 'Clear History'}
                    </button>
                  )}
                </div>

                <div className="space-y-2 max-h-[390px] overflow-y-auto">
                  {history.length === 0 ? (
                    <p className="text-xs text-[#94A3B8] text-center py-12">
                      {locale === 'pt-PT'
                        ? 'Sem histórico de reprodução registado.'
                        : 'No playback history recorded yet.'}
                    </p>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 p-2.5 rounded-2xl bg-[#181C24] border border-white/5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                          <p className="text-[11px] text-[#94A3B8] truncate">
                            {item.artist} • {item.requestedByName || 'Discord'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handlePlayDirectQuery(item.sourceUrl)}
                          className="p-2 rounded-xl bg-[#12151B] hover:bg-[#10B981] text-[#34D399] hover:text-[#052018] transition cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* 6. ABA: CONFIGURAÇÕES DO SERVIDOR & CARGOS DJ */}
            {activeTab === 'settings' && guildSettings && (
              <div className="flex-1 pt-4 space-y-5 overflow-y-auto max-h-[430px]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-[#181C24] border border-white/5 space-y-2">
                    <label className="text-xs font-semibold text-white flex items-center gap-2">
                      <Globe className="w-4 h-4 text-[#34D399]" />
                      {locale === 'pt-PT'
                        ? 'Idioma Padrão do Servidor'
                        : 'Server Default Language'}
                    </label>
                    <select
                      disabled={!user.isAdmin}
                      value={guildSettings.language}
                      onChange={async (e) => {
                        const res = await api.updateSettings({
                          language: e.target.value as SupportedLocale
                        });
                        setGuildSettings(res.settings);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-[#12151B] border border-white/10 text-xs text-white"
                    >
                      <option value="pt-PT">Português (Portugal)</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#181C24] border border-white/5 space-y-2">
                    <label className="text-xs font-semibold text-white">
                      {locale === 'pt-PT'
                        ? `Volume Padrão (${guildSettings.defaultVolume}%)`
                        : `Default Volume (${guildSettings.defaultVolume}%)`}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={200}
                      disabled={!user.isAdmin}
                      value={guildSettings.defaultVolume}
                      onChange={async (e) => {
                        const vol = Number(e.target.value);
                        setGuildSettings({ ...guildSettings, defaultVolume: vol });
                        const res = await api.updateSettings({ defaultVolume: vol });
                        setGuildSettings(res.settings);
                      }}
                      className="w-full accent-[#10B981]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="p-4 rounded-2xl bg-[#181C24] border border-white/5 flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-xs font-semibold text-white">
                        {locale === 'pt-PT' ? 'Modo Exclusivo DJ' : 'DJ-Only Mode'}
                      </p>
                      <p className="text-[11px] text-[#94A3B8]">
                        {locale === 'pt-PT'
                          ? 'Restringe skip, stop, volume e limpeza de fila a DJs/Admins'
                          : 'Restricts skip, stop, volume and clear to DJs/Admins'}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      disabled={!user.isAdmin}
                      checked={guildSettings.djOnlyMode}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ djOnlyMode: e.target.checked });
                        setGuildSettings(res.settings);
                      }}
                      className="w-4 h-4 accent-[#10B981]"
                    />
                  </label>

                  <label className="p-4 rounded-2xl bg-[#181C24] border border-white/5 flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-xs font-semibold text-white">
                        {locale === 'pt-PT' ? 'Permanecer na Call 24/7' : 'Stay in Voice 24/7'}
                      </p>
                      <p className="text-[11px] text-[#94A3B8]">
                        {locale === 'pt-PT'
                          ? 'Desativa a saída automática por inatividade'
                          : 'Disables automatic idle voice disconnection'}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      disabled={!user.isAdmin}
                      checked={guildSettings.stayInVoice}
                      onChange={async (e) => {
                        const res = await api.updateSettings({ stayInVoice: e.target.checked });
                        setGuildSettings(res.settings);
                      }}
                      className="w-4 h-4 accent-[#10B981]"
                    />
                  </label>
                </div>

                {/* Gestão de Cargos de DJ */}
                <div className="p-4 rounded-2xl bg-[#181C24] border border-white/5 space-y-3">
                  <h4 className="text-xs font-bold text-white">
                    {locale === 'pt-PT' ? 'Cargos de DJ Autorizados' : 'Authorized DJ Roles'}
                  </h4>

                  <div className="flex flex-wrap gap-2">
                    {djRoles.length === 0 ? (
                      <span className="text-xs text-[#94A3B8]">
                        {locale === 'pt-PT'
                          ? 'Nenhum cargo específico configurado.'
                          : 'No specific DJ roles configured.'}
                      </span>
                    ) : (
                      djRoles.map((r) => (
                        <span
                          key={r.roleId}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-[#10B981]/15 border border-[#10B981]/30 text-[#34D399]"
                        >
                          @{r.roleName}
                          {user.isAdmin && (
                            <button
                              type="button"
                              onClick={async () => {
                                const res = await api.removeDjRole(r.roleId);
                                setDjRoles(res.djRoles);
                              }}
                              className="hover:text-red-400"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>

                  {user.isAdmin && availableRoles.length > 0 && (
                    <div className="flex gap-2 pt-1">
                      <select
                        value={selectedRoleToAdd}
                        onChange={(e) => setSelectedRoleToAdd(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#12151B] border border-white/10 text-xs text-white"
                      >
                        <option value="">
                          {locale === 'pt-PT'
                            ? 'Selecionar cargo do servidor Discord...'
                            : 'Select Discord server role...'}
                        </option>
                        {availableRoles.map((role) => (
                          <option key={role.id} value={role.id}>
                            @{role.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const found = availableRoles.find((r) => r.id === selectedRoleToAdd);
                          if (!found) return;
                          const res = await api.addDjRole(found.id, found.name);
                          setDjRoles(res.djRoles);
                          setSelectedRoleToAdd('');
                        }}
                        className="px-4 py-2 rounded-xl bg-[#10B981] text-[#052018] text-xs font-semibold"
                      >
                        {locale === 'pt-PT' ? 'Adicionar Cargo' : 'Add Role'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Modal de Confirmação para Eliminar Playlist */}
      {playlistToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#12151B] border border-white/15 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">
              {locale === 'pt-PT' ? 'Eliminar Playlist?' : 'Delete Playlist?'}
            </h3>
            <p className="text-xs text-[#94A3B8]">
              {t(locale, 'web.confirm.deletePlaylist', { name: playlistToDelete.name })}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPlaylistToDelete(null)}
                className="px-4 py-2 rounded-xl bg-[#181C24] text-xs text-white cursor-pointer"
              >
                {locale === 'pt-PT' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePlaylist}
                className="px-4 py-2 rounded-xl bg-[#EF4444] text-xs font-semibold text-white cursor-pointer"
              >
                {locale === 'pt-PT' ? 'Confirmar Eliminação' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
