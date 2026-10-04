import { type Settings } from '../config/settings.js';
type Entry = { at: number; content: string };
export class SpamDetector {
  private messages = new Map<string, Entry[]>();
  inspect(
    key: string,
    content: string,
    mentions: number,
    config: Settings['moderation'],
    now = Date.now(),
  ) {
    if (!config.enabled) return null;
    if (this.messages.size > 10000)
      for (const [k, list] of this.messages)
        if ((list.at(-1)?.at ?? 0) < now - 120000) this.messages.delete(k);
    const normalized = content.toLocaleLowerCase().trim().replace(/\s+/g, ' ');
    const entries = (this.messages.get(key) ?? []).filter(
      (e) => e.at > now - config.windowSeconds * 1000,
    );
    entries.push({ at: now, content: normalized });
    this.messages.set(key, entries.slice(-100));
    if (mentions >= config.mentionLimit) return 'Mention spam';
    if (
      config.badWords.some((word) =>
        normalized.split(/[^\p{L}\p{N}_]+/u).includes(word.toLowerCase()),
      )
    )
      return 'Configured bad-word filter';
    if (
      normalized &&
      entries.filter((e) => e.content === normalized).length >=
        config.duplicateCount
    )
      return 'Duplicate messages';
    if (entries.length >= config.floodCount) return 'Message flood';
    return null;
  }
}
