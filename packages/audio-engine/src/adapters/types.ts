import type { Readable } from 'node:stream';
import type { AudioSourceType, Track, TrackRequester } from '@sonora/shared';

export interface PcmAudioStreamHandle {
  stream: Readable;
  cleanup: () => void;
}

export interface AudioSourceAdapter {
  readonly sourceType: Exclude<AudioSourceType, 'spotify'>;
  canHandle(queryOrUrl: string): boolean;
  resolveTrack(queryOrUrl: string, requester: TrackRequester | null): Promise<Track>;
  createPcmStream(track: Track): Promise<PcmAudioStreamHandle>;
}
