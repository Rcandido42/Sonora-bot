// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App.js';
import type { SonoraApiClient } from './api.js';

function createMockApiClient(authenticated: boolean): SonoraApiClient {
  const mockTrack = {
    id: 'yt:abc12345678',
    title: 'Midnight City',
    artist: 'M83',
    durationMs: 243000,
    artworkUrl: null,
    source: 'youtube' as const,
    sourceUrl: 'https://www.youtube.com/watch?v=abc12345678',
    addedAt: new Date().toISOString(),
    requestedBy: {
      id: '111222333444555666',
      username: 'TesterDJ',
      displayName: 'Tester DJ',
      avatarUrl: null
    }
  };

  const client = {
    setCsrfToken: vi.fn(),
    getHealth: vi.fn().mockResolvedValue({
      status: 'ok',
      brand: 'Sonora',
      botReady: true,
      botTag: 'Sonora#1000',
      guildId: '999888777666555444',
      guildName: 'Comunidade Sonora',
      databaseIntegrity: true,
      oauthConfigured: true,
      devLoginAvailable: true
    }),
    getMe: vi.fn().mockResolvedValue(
      authenticated
        ? {
            authenticated: true,
            csrfToken: 'csrf_test_123',
            oauthConfigured: true,
            user: {
              id: '111222333444555666',
              username: 'TesterDJ',
              displayName: 'Tester DJ',
              avatarUrl: null,
              guildId: '999888777666555444',
              isAdmin: true,
              isDj: true,
              roleIds: [],
              preferredLanguage: 'pt-PT'
            }
          }
        : {
            authenticated: false,
            oauthConfigured: true,
            devLoginAvailable: true
          }
    ),
    getPlayerState: vi.fn().mockResolvedValue({
      guildId: '999888777666555444',
      voiceChannelId: '123456789012345678',
      voiceChannelName: 'Palco Musical',
      textChannelId: null,
      status: 'playing',
      currentTrack: mockTrack,
      queue: [
        {
          ...mockTrack,
          id: 'yt:next999',
          title: 'Starboy',
          artist: 'The Weeknd'
        }
      ],
      positionMs: 42000,
      volume: 95,
      loopMode: 'off',
      shuffled: false,
      lastError: null,
      botConnected: true,
      updatedAt: new Date().toISOString()
    }),
    getFavorites: vi.fn().mockResolvedValue({ favorites: [] }),
    getPlaylists: vi.fn().mockResolvedValue({
      playlists: [
        {
          id: 1,
          userId: '111222333444555666',
          guildId: '999888777666555444',
          name: 'Favoritas da Noite',
          description: 'Synth & Pop',
          trackCount: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
    }),
    getHistory: vi.fn().mockResolvedValue({ history: [] }),
    getSettings: vi.fn().mockResolvedValue({
      settings: {
        guildId: '999888777666555444',
        language: 'pt-PT',
        defaultVolume: 80,
        djOnlyMode: false,
        stayInVoice: false,
        updatedAt: new Date().toISOString()
      },
      djRoles: [],
      availableRoles: []
    }),
    pause: vi.fn().mockResolvedValue({
      guildId: '999888777666555444',
      voiceChannelId: '123456789012345678',
      voiceChannelName: 'Palco Musical',
      textChannelId: null,
      status: 'paused',
      currentTrack: mockTrack,
      queue: [],
      positionMs: 42000,
      volume: 95,
      loopMode: 'off',
      shuffled: false,
      lastError: null,
      botConnected: true,
      updatedAt: new Date().toISOString()
    }),
    setUserLanguage: vi.fn().mockResolvedValue({ language: 'en' })
  };

  return client as unknown as SonoraApiClient;
}

describe('Fase 9 — Painel Web Sonora (React UI)', () => {
  it('renderiza o ecrã de login com a identidade Sonora, botão Discord OAuth2 e seletor de idioma', async () => {
    const mockApi = createMockApiClient(false);
    render(<App apiClient={mockApi} disableWebSocket />);

    await waitFor(() => {
      expect(screen.getByText(/Sonora Studio/i)).toBeTruthy();
    });

    expect(screen.getByText(/Entrar com o Discord/i)).toBeTruthy();
    expect(screen.getByText(/Comunidade Sonora/i)).toBeTruthy();

    // Alternar idioma para Inglês no ecrã de login
    fireEvent.click(screen.getByText('EN'));
    expect(screen.getByText(/Sign in with Discord/i)).toBeTruthy();
  });

  it('renderiza o leitor em tempo real, capa de fallback Sonora, fila partilhada e abas de playlists', async () => {
    const mockApi = createMockApiClient(true);
    render(<App apiClient={mockApi} disableWebSocket />);

    await waitFor(() => {
      expect(screen.getByText('Midnight City')).toBeTruthy();
    });

    expect(screen.getByText('M83')).toBeTruthy();
    expect(screen.getByText('Starboy')).toBeTruthy();
    expect(screen.getByText(/#Palco Musical/i)).toBeTruthy();

    // Verificar fallback de capa oficial quando artworkUrl é null
    const coverImg = screen.getByAltText('Midnight City') as HTMLImageElement;
    expect(coverImg.getAttribute('src')).toBe('/branding/cover-fallback.svg');

    // Navegar para a aba de Playlists
    fireEvent.click(screen.getByText(/Playlists \(1\)/i));
    await waitFor(() => {
      expect(screen.getByText('Favoritas da Noite')).toBeTruthy();
    });
  });
});
