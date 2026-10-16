import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const REDACTED_LOG_PATHS = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'SESSION_SECRET',
  'SPOTIFY_CLIENT_SECRET',
  'GENIUS_ACCESS_TOKEN',
  'token',
  'secret',
  'password',
  'accessToken',
  'refreshToken',
  'clientSecret',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.token',
  '*.secret',
  '*.accessToken',
  '*.clientSecret'
];

export function createLogger(
  name = 'sonora',
  level: string = process.env.LOG_LEVEL ?? 'info',
  destination?: DestinationStream
): Logger {
  const options: LoggerOptions = {
    name,
    level,
    redact: {
      paths: REDACTED_LOG_PATHS,
      censor: '[REDACTED]'
    },
    timestamp: pino.stdTimeFunctions.isoTime
  };

  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger('sonora');
