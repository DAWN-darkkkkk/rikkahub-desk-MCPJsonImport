/**
 * PC port of speech/src/main/java/me/rerere/tts/model/PlaybackState.kt.
 * Identical shape — used by the play-bar UI to render the inner/outer rings.
 */

export type PlaybackStatus = "Idle" | "Buffering" | "Playing" | "Paused" | "Ended" | "Error";

export interface PlaybackState {
  status: PlaybackStatus;
  /** Position within the CURRENT chunk, ms. */
  positionMs: number;
  /** Duration of the CURRENT chunk, ms (0 until known). */
  durationMs: number;
  /** Playback speed multiplier (1.0 = normal). */
  speed: number;
  /** 1-based index of the chunk currently being processed/played. 0 when idle. */
  currentChunkIndex: number;
  /** Total chunks for the current speak() session (remaining + just-played). */
  totalChunks: number;
  /** Last error string, if any. */
  errorMessage: string | null;
  /** Stable session id; bumps every time speak() with flush=true is invoked. */
  sessionId: string | null;
  /** Optional owner key supplied by the caller (e.g. message id). */
  ownerKey: string | null;
}

export const initialPlaybackState: PlaybackState = {
  status: "Idle",
  positionMs: 0,
  durationMs: 0,
  speed: 1.0,
  currentChunkIndex: 0,
  totalChunks: 0,
  errorMessage: null,
  sessionId: null,
  ownerKey: null,
};
