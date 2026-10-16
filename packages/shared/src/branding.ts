export const SONORA_BRAND = {
  name: 'Sonora',
  upperName: 'SONORA',
  tagline: {
    'pt-PT': 'Bot de Música Discord & Leitor Web Premium',
    en: 'Premium Discord Music Bot & Web Player'
  },
  colors: {
    bgPrimary: '#090A0C',
    bgElevated: '#12151B',
    bgSurface: '#181C24',
    borderSubtle: '#1E2430',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    accent: '#10B981',
    accentHover: '#059669',
    accentSoft: 'rgba(16, 185, 129, 0.14)',
    danger: '#EF4444',
    warning: '#F59E0B',
    discordEmbedAccent: 0x10b981,
    discordEmbedError: 0xef4444,
    discordEmbedWarning: 0xf59e0b,
    discordEmbedIdle: 0x1e2430
  },
  assets: {
    symbolDark: '/branding/sonora-symbol-dark.svg',
    symbolLight: '/branding/sonora-symbol-light.svg',
    horizontalDark: '/branding/sonora-horizontal-dark.svg',
    horizontalLight: '/branding/sonora-horizontal-light.svg',
    faviconSvg: '/branding/favicon.svg',
    faviconPng32: '/branding/favicon-32.png',
    discordAvatarPng512: '/branding/discord-avatar-512.png',
    coverFallbackSvg: '/branding/cover-fallback.svg',
    coverFallbackPng512: '/branding/cover-fallback-512.png',
    discordCoverAttachmentName: 'sonora-cover-fallback.png'
  }
} as const;

export type SonoraBrandConfig = typeof SONORA_BRAND;
