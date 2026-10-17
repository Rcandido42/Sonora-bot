import { z } from 'zod';

export const SupportedLocaleSchema = z.enum(['pt-PT', 'en']);

export const TrackSourceSchema = z.enum(['youtube', 'soundcloud', 'direct']);

export const PersistableTrackSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(400),
  artist: z.string().min(1).max(300),
  durationMs: z.number().int().positive().nullable().optional().default(null),
  artworkUrl: z.string().url().nullable().optional().default(null),
  source: TrackSourceSchema,
  sourceUrl: z.string().url(),
  requestedBy: z
    .object({
      id: z.string().min(1),
      username: z.string().min(1),
      displayName: z.string().optional()
    })
    .nullable()
    .optional()
    .default(null)
});

export const GuildSettingsUpdateSchema = z.object({
  language: SupportedLocaleSchema.optional(),
  defaultVolume: z.number().int().min(0).max(200).optional(),
  djOnlyMode: z.boolean().optional(),
  stayInVoice: z.boolean().optional()
});

export const DjRoleInputSchema = z.object({
  guildId: z.string().min(1),
  roleId: z.string().min(1),
  roleName: z.string().min(1).max(120)
});

export const CreatePlaylistInputSchema = z.object({
  userId: z.string().min(1),
  guildId: z.string().min(1),
  name: z.string().trim().min(1, 'O nome da playlist é obrigatório').max(80),
  description: z.string().trim().max(300).nullable().optional().default(null)
});

export const UpdatePlaylistInputSchema = z.object({
  name: z.string().trim().min(1, 'O nome da playlist é obrigatório').max(80),
  description: z.string().trim().max(300).nullable().optional().default(null)
});

export const SessionRecordInputSchema = z.object({
  sessionId: z.string().min(24),
  userId: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  avatarUrl: z.string().nullable().optional().default(null),
  guildId: z.string().min(1),
  isAdmin: z.boolean(),
  isDj: z.boolean(),
  roleIds: z.array(z.string()),
  csrfToken: z.string().min(24),
  expiresAt: z.string().min(1)
});
