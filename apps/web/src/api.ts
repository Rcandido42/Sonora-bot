import type {
  AuthenticatedUser,
  DjRole,
  FavoriteTrack,
  GuildSettings,
  LoopMode,
  LyricsResult,
  PlaybackHistoryEntry,
  PlayerStateSnapshot,
  Playlist,
  SupportedLocale,
  Track
} from '@sonora/shared';

export interface HealthResponse {
  status: string;
  brand: string;
  botReady: boolean;
  botTag: string | null;
  guildId: string;
  guildName: string;
  databaseIntegrity: boolean;
  oauthConfigured: boolean;
  devLoginAvailable: boolean;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: AuthenticatedUser;
  csrfToken?: string;
  oauthConfigured: boolean;
  devLoginAvailable?: boolean;
}

export interface PersistableTrackPayload {
  id: string;
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
  source: 'youtube' | 'soundcloud' | 'direct';
  sourceUrl: string;
}

export function trackToPersistable(track: Track): PersistableTrackPayload {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    durationMs: track.durationMs,
    artworkUrl: track.artworkUrl,
    source: track.source,
    sourceUrl: track.sourceUrl
  };
}

export class SonoraApiClient {
  private csrfToken = '';

  public setCsrfToken(token: string): void {
    this.csrfToken = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes((init.method ?? 'GET').toUpperCase())) {
      headers.set('X-CSRF-Token', this.csrfToken);
    }

    const res = await fetch(path, {
      ...init,
      headers,
      credentials: 'include'
    });

    if (!res.ok) {
      let errMessage = `Erro HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) errMessage = body.message;
      } catch {
        // Ignore JSON parse error
      }
      throw new Error(errMessage);
    }

    return (await res.json()) as T;
  }

  public getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health');
  }

  public getMe(): Promise<AuthMeResponse> {
    return this.request<AuthMeResponse>('/api/auth/me');
  }

  public async devLogin(username?: string): Promise<{ user: AuthenticatedUser; csrfToken: string }> {
    const res = await this.request<{ user: AuthenticatedUser; csrfToken: string }>('/api/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
    this.setCsrfToken(res.csrfToken);
    return res;
  }

  public logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  }

  public getPlayerState(): Promise<PlayerStateSnapshot> {
    return this.request<PlayerStateSnapshot>('/api/player/state');
  }

  public play(query: string): Promise<{
    startedImmediately: boolean;
    queuedPosition: number | null;
    tracksAdded: Track[];
    state: PlayerStateSnapshot;
  }> {
    return this.request('/api/player/play', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
  }

  public pause(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/pause', { method: 'POST' });
  }

  public resume(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/resume', { method: 'POST' });
  }

  public skip(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/skip', { method: 'POST' });
  }

  public stop(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/stop', { method: 'POST' });
  }

  public leave(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/leave', { method: 'POST' });
  }

  public setVolume(volume: number): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/volume', {
      method: 'POST',
      body: JSON.stringify({ volume })
    });
  }

  public setLoop(mode: LoopMode): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/loop', {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
  }

  public shuffle(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/shuffle', { method: 'POST' });
  }

  public clearQueue(): Promise<PlayerStateSnapshot> {
    return this.request('/api/player/clear', { method: 'POST' });
  }

  public removeQueuePosition(position: number): Promise<{ removed: Track; state: PlayerStateSnapshot }> {
    return this.request(`/api/player/queue/${position}`, { method: 'DELETE' });
  }

  public getLyrics(query?: string): Promise<{ lyrics: LyricsResult }> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return this.request(`/api/lyrics${qs}`);
  }

  public getFavorites(): Promise<{ favorites: FavoriteTrack[] }> {
    return this.request('/api/favorites');
  }

  public addFavorite(track: PersistableTrackPayload): Promise<{ added: boolean; item: FavoriteTrack }> {
    return this.request('/api/favorites', {
      method: 'POST',
      body: JSON.stringify(track)
    });
  }

  public removeFavorite(trackId: string): Promise<{ removed: boolean }> {
    return this.request(`/api/favorites/${encodeURIComponent(trackId)}`, {
      method: 'DELETE'
    });
  }

  public getPlaylists(): Promise<{ playlists: Playlist[] }> {
    return this.request('/api/playlists');
  }

  public getPlaylistById(id: number): Promise<{ playlist: Playlist }> {
    return this.request(`/api/playlists/${id}`);
  }

  public createPlaylist(name: string, description?: string): Promise<{ playlist: Playlist }> {
    return this.request('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description: description || null })
    });
  }

  public deletePlaylist(id: number): Promise<{ deleted: boolean }> {
    return this.request(`/api/playlists/${id}`, { method: 'DELETE' });
  }

  public addTrackToPlaylist(
    playlistId: number,
    track: PersistableTrackPayload
  ): Promise<{ playlist: Playlist }> {
    return this.request(`/api/playlists/${playlistId}/tracks`, {
      method: 'POST',
      body: JSON.stringify(track)
    });
  }

  public removeTrackFromPlaylist(
    playlistId: number,
    itemId: number
  ): Promise<{ removed: boolean; playlist: Playlist }> {
    return this.request(`/api/playlists/${playlistId}/tracks/${itemId}`, {
      method: 'DELETE'
    });
  }

  public playPlaylist(playlistId: number): Promise<{ queuedCount: number; state: PlayerStateSnapshot }> {
    return this.request(`/api/playlists/${playlistId}/play`, { method: 'POST' });
  }

  public getHistory(): Promise<{ history: PlaybackHistoryEntry[] }> {
    return this.request('/api/history');
  }

  public clearHistory(): Promise<{ cleared: number }> {
    return this.request('/api/history', { method: 'DELETE' });
  }

  public getSettings(): Promise<{
    settings: GuildSettings;
    djRoles: DjRole[];
    availableRoles: Array<{ id: string; name: string; color: string }>;
  }> {
    return this.request('/api/settings');
  }

  public updateSettings(patch: Partial<{
    language: SupportedLocale;
    defaultVolume: number;
    djOnlyMode: boolean;
    stayInVoice: boolean;
  }>): Promise<{ settings: GuildSettings; djRoles: DjRole[] }> {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch)
    });
  }

  public addDjRole(roleId: string, roleName: string): Promise<{ djRoles: DjRole[] }> {
    return this.request('/api/settings/dj-roles', {
      method: 'POST',
      body: JSON.stringify({ roleId, roleName })
    });
  }

  public removeDjRole(roleId: string): Promise<{ djRoles: DjRole[] }> {
    return this.request(`/api/settings/dj-roles/${encodeURIComponent(roleId)}`, {
      method: 'DELETE'
    });
  }

  public setUserLanguage(language: SupportedLocale): Promise<{ language: SupportedLocale }> {
    return this.request('/api/user/language', {
      method: 'PUT',
      body: JSON.stringify({ language })
    });
  }
}
