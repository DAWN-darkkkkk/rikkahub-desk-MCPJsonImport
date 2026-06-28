/**
 * Floating play-bar. Direct PC port of Android's TTSController.kt composable.
 *
 * Layout: [progress rings + chunk N/M] [status] [⏪ ⏯ ⏩] [×speed] [✕]
 *
 * Two concentric arcs:
 *   OUTER = positionMs / durationMs (progress within current chunk)
 *   INNER = currentChunkIndex / totalChunks (overall session progress)
 *
 * The bar is draggable so the user can reposition it if it covers content.
 */

import * as React from "react";
import { FastForward, Pause, Play, Rewind, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

import { ttsController, useTtsPlaybackState } from "~/lib/tts/tts-controller";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

const SPEED_OPTIONS = [0.8, 1.0, 1.2, 1.5] as const;

export function TtsPlayBar() {
  const state = useTtsPlaybackState();
  const visible = state.status !== "Idle" && state.status !== "Ended";
  const [speedOpen, setSpeedOpen] = React.useState(false);

  // Drag state
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, [role=button]")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setOffset({
      x: dragRef.current.ox + (e.clientX - dragRef.current.startX),
      y: dragRef.current.oy + (e.clientY - dragRef.current.startY),
    });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const totalChunks = Math.max(1, state.totalChunks);
  const currentChunk = Math.max(1, Math.min(state.currentChunkIndex || 1, totalChunks));
  const chunkFraction = state.durationMs > 0 ? Math.min(1, state.positionMs / state.durationMs) : 0;
  const overallFraction = Math.min(1, currentChunk / totalChunks);

  const isPlaying = state.status === "Playing";
  const isPaused = state.status === "Paused";
  const isBuffering = state.status === "Buffering";

  const togglePlayPause = () => {
    if (isPlaying || isBuffering) ttsController.pause();
    else if (isPaused) ttsController.resume();
  };

  const OUTER_R = 24;
  const INNER_R = 17;
  const outerC = 2 * Math.PI * OUTER_R;
  const innerC = 2 * Math.PI * INNER_R;

  const statusLabel = state.errorMessage
    ? state.errorMessage
    : isBuffering
      ? "合成中..."
      : isPaused
        ? "已暂停"
        : "朗读中";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="tts-play-bar"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-none fixed bottom-28 left-1/2 z-40"
          style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
        >
          <div
            className="pointer-events-auto flex cursor-grab items-center gap-2 rounded-full border border-border/60 bg-background/95 px-4 py-2.5 shadow-lg backdrop-blur active:cursor-grabbing"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Progress rings. Number is OUTSIDE the rings to avoid overlap at 2+ digits. */}
            <div className="flex items-center gap-1.5">
              <div className="relative flex size-11 shrink-0 items-center justify-center">
                <svg viewBox="0 0 56 56" className="absolute inset-0 size-11 -rotate-90">
                  <circle
                    cx="28"
                    cy="28"
                    r={OUTER_R}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-muted-foreground/20"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r={OUTER_R}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray={outerC}
                    strokeDashoffset={outerC * (1 - chunkFraction)}
                    strokeLinecap="round"
                    className="text-primary transition-[stroke-dashoffset] duration-100"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r={INNER_R}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    className="text-muted-foreground/15"
                  />
                  <circle
                    cx="28"
                    cy="28"
                    r={INNER_R}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeDasharray={innerC}
                    strokeDashoffset={innerC * (1 - overallFraction)}
                    strokeLinecap="round"
                    className="text-primary/70 transition-[stroke-dashoffset] duration-200"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium tabular-nums text-foreground">
                {currentChunk}/{totalChunks}
              </span>
            </div>

            <span
              className={cn(
                "min-w-[3rem] text-sm",
                state.errorMessage ? "text-destructive" : "text-muted-foreground",
              )}
              title={statusLabel}
            >
              {statusLabel}
            </span>

            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => ttsController.seekBy(-5_000)}
                title="后退 5 秒"
              >
                <Rewind className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10"
                onClick={togglePlayPause}
                title={isPlaying || isBuffering ? "暂停" : "继续"}
              >
                {isPlaying || isBuffering ? (
                  <Pause className="size-5" />
                ) : (
                  <Play className="size-5 translate-x-[1px]" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => ttsController.seekBy(5_000)}
                title="前进 5 秒"
              >
                <FastForward className="size-4" />
              </Button>
              <Popover open={speedOpen} onOpenChange={setSpeedOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2.5 text-sm tabular-nums"
                  >
                    ×{state.speed.toFixed(1)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" align="center" className="w-24 p-1">
                  <div className="flex flex-col gap-0.5">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          ttsController.setSpeed(s);
                          setSpeedOpen(false);
                        }}
                        className={cn(
                          "rounded px-2 py-1 text-left text-sm tabular-nums hover:bg-muted",
                          Math.abs(s - state.speed) < 0.01 && "bg-primary/10 text-primary",
                        )}
                      >
                        ×{s.toFixed(1)}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                onClick={() => ttsController.stop()}
                title="停止"
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
