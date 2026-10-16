export type SupportedLocale = 'pt-PT' | 'en';

export type AudioSourceType = 'youtube' | 'soundcloud' | 'direct' | 'spotify';

export type LoopMode = 'off' | 'track' | 'queue';

export type PlaybackStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'error';

export interface TrackRequester {
  id: string;
  username: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  source: Exclude<AudioSourceType, 'spotify'>;
  sourceUrl: string;
  streamUrl?: string;
  matchedFromSpotifyUrl?: string | null;
  requestedBy: TrackRequester | null;
  addedAt: string;
}

export interface PlayerStateSnapshot {
  guildId: string;
  voiceChannelId: string | null;
  voiceChannelName: string | null;
  textChannelId: string | null;
  status: PlaybackStatus;
  currentTrack: Track | null;
  queue: Track[];
  volume: number;
  loopMode: LoopMode;
  shuffled: boolean;
  positionMs: number;
  lastError: string | null;
  botConnected: boolean;
  updatedAt: string;
}

export interface GuildSettings {
  guildId: string;
  language: SupportedLocale;
  defaultVolume: number;
  djOnlyMode: boolean;
  stayInVoice: boolean;
  updatedAt: string;
}

export interface DjRole {
  guildId: string;
  roleId: string;
  roleName: string;
  addedAt: string;
}

export interface FavoriteTrack {
  id: number;
  userId: string;
  trackId: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  source: Exclude<AudioSourceType, 'spotify'>;
  sourceUrl: string;
  createdAt: string;
}

export interface PlaylistTrackItem {
  id: number;
  playlistId: number;
  position: number;
  trackId: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  source: Exclude<AudioSourceType, 'spotify'>;
  sourceUrl: string;
  addedAt: string;
}

export interface Playlist {
  id: number;
  userId: string;
  guildId: string;
  name: string;
  description: string | null;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
  tracks?: PlaylistTrackItem[];
}

export interface PlaybackHistoryEntry {
  id: number;
  guildId: string;
  trackId: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  source: Exclude<AudioSourceType, 'spotify'>;
  sourceUrl: string;
  requestedById: string | null;
  requestedByName: string | null;
  playedAt: string;
}

export interface SyncedLyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  trackTitle: string;
  artistName: string;
  provider: 'lrclib' | 'genius' | 'none';
  plainLyrics: string | null;
  syncedLyrics: SyncedLyricLine[] | null;
  externalUrl: string | null;
  isTruncated: boolean;
  copyrightNotice: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  guildId: string;
  isAdmin: boolean;
  isDj: boolean;
  roleIds: string[];
  preferredLanguage: SupportedLocale;
}

export type WebSocketEventMessage =
  | { type: 'player:state'; payload: PlayerStateSnapshot }
  | { type: 'settings:updated'; payload: { settings: GuildSettings; djRoles: DjRole[] } }
  | { type: 'history:updated'; payload: PlaybackHistoryEntry[] }
  | { type: 'ping'; payload: { timestamp: number } };
