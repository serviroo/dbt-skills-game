import type { Chapter, Story } from './storystore';
import { uid } from './store';
import type { StoryOrigins } from './story-origins';

/** Every version a restore writes gets a rev of its own, so an editor still holding the file's rev can't write over it.
 */
export const importRev = () => `imp~${uid()}`;

/** Where a decision reads and writes: one IndexedDB transaction, or this copy's memory when that isn't possible. */
export interface View {
  story(id: string): Promise<Story | undefined>;
  chapter(id: string): Promise<Chapter | undefined>;
  /** The stored version and this copy's memory version apart (no stored one when the database can't be used). */
  versions(id: string): Promise<{ disk?: Chapter; mem?: Chapter }>;
  taken(id: string): Promise<boolean>;
  putStory(s: Story): void;
  putChapter(c: Chapter): void;
}

/** A story for a chapter whose story is gone (deleted elsewhere while it was open), so the chapter stays reachable. */
export function keptStory(id: string, stamp: number, v: View): Story {
  const notes: Chapter = { id: uid(), story: id, kind: 'notes', title: 'Notes', text: '', updated: stamp, rev: uid() };
  v.putChapter(notes);
  return { id, title: 'Kept story', created: stamp, updated: stamp, rev: uid(), chapters: [], notes: notes.id };
}

export function cardStored(
  id: string, stories: Map<string, Story>, chapters: Map<string, Chapter>, origins: StoryOrigins,
) {
  origins.wrote();
  for (const [sid, story] of stories) if (story.notes === id || story.chapters.includes(id)) origins.stored(sid);
  const chapter = chapters.get(id);
  if (chapter) origins.stored(chapter.story);
}

export function announceStory(channel: BroadcastChannel | null): BroadcastChannel | null {
  try { channel?.postMessage('changed'); return channel; } catch { return null; }
}

/** A view that reads through to base and keeps what a restore would write in memory, so a dry run decides alike. */
export function dryView(base: View, over: { stories: Map<string, Story>; chapters: Map<string, Chapter> }): View {
  return {
    story: async (id) => over.stories.get(id) ?? base.story(id),
    chapter: async (id) => over.chapters.get(id) ?? base.chapter(id),
    versions: async (id) => {
      const v = await base.versions(id);
      const o = over.chapters.get(id);
      return o ? { disk: o, mem: v.mem } : v;
    },
    taken: async (id) => over.chapters.has(id) || base.taken(id),
    putStory: (s) => void over.stories.set(s.id, s),
    putChapter: (c) => void over.chapters.set(c.id, c),
  };
}
