/**
 * PC port of speech/src/main/java/me/rerere/tts/controller/TextChunker.kt.
 *
 * The Kotlin version splits long text into speakable chunks with basic punctuation-aware
 * grouping. This is a literal translation:
 *   1) split on paragraph boundaries (`\n\n`)
 *   2) within each paragraph, split on the punctuation set
 *      `。！？，、：;.!?:,\n` (using a lookbehind so the punctuation stays attached
 *      to the segment it ends)
 *   3) greedily accumulate segments into chunks of `maxChunkLength` chars
 *
 * Keeping the algorithm identical matters because:
 *   - chunk boundaries directly affect how natural the speech sounds (esp. for Chinese
 *     where 。！？ are sentence terminators and the API needs them at the end of a chunk)
 *   - per-chunk billing parity with Android: if both clients chunk the same way, the
 *     same paused-mid-playback save behavior emerges on both ends.
 */

import { v4 as uuid } from "uuid";

export interface TtsChunk {
  id: string;
  index: number;
  text: string;
}

const PUNCTUATION_LOOKBEHIND = /(?<=[。！？，、：;.!?:,\n])/;

export class TextChunker {
  constructor(private readonly maxChunkLength = 160) {}

  split(text: string): TtsChunk[] {
    if (!text.trim()) return [];

    const paragraphs = text.split("\n\n");

    const accumulated: string[] = [];
    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;
      // Lookbehind keeps punctuation attached. Filter empty + trim.
      const segments = paragraph
        .split(PUNCTUATION_LOOKBEHIND)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

      // Greedy accumulator — mirrors Kotlin's `fold(mutableListOf<StringBuilder>()) { acc, seg -> ... }`.
      const bucket: string[] = [];
      for (const segment of segments) {
        if (
          bucket.length === 0 ||
          bucket[bucket.length - 1].length + segment.length > this.maxChunkLength
        ) {
          bucket.push(segment);
        } else {
          bucket[bucket.length - 1] = bucket[bucket.length - 1] + segment;
        }
      }
      accumulated.push(...bucket);
    }

    return accumulated.map((value, index) => ({
      id: uuid(),
      index,
      text: value,
    }));
  }
}
