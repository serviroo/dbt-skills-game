/**
 * A story as a plain text file and back. Download writes the title as "# Title" and each chapter as "## Chapter",
 * with Notes last under "## Notes for this story", so a downloaded story comes back in exactly as it went out. A line
 * of the player's own that would read as one of those headings gets a backslash in front, taken off again on the
 * way in. Bringing a file in reads it as plain text only: nothing in it is ever run or shown as markup.
 */

export interface StoryText {
  title: string;
  chapters: { title: string; text: string }[];
  notes: string;
}

/** What Download writes for Notes, so Notes come back as Notes and a chapter called "Notes" stays a chapter. */
export const NOTES_HEAD = 'Notes for this story';
const HEAD = /^(#{1,2})[ \t]+(.*?)[ \t]*$/;
const OWN_HEAD = /^(\\*#{1,2}[ \t])/;
const escape = (text: string) => text.replace(/^(\\*#{1,2}[ \t])/gm, '\\$1');
const unescape = (text: string) => text.replace(/^\\(\\*#{1,2}[ \t])/gm, '$1');
const tidy = (lines: string[]) => lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');

export function storyToText(s: StoryText): string {
  const parts = [`# ${s.title}`];
  for (const c of s.chapters) parts.push(`## ${c.title}`, escape(c.text.replace(/\s+$/, '')));
  if (s.notes.trim()) parts.push(`## ${NOTES_HEAD}`, escape(s.notes.replace(/\s+$/, '')));
  return `${parts.filter((x, i) => i === 0 || x !== '' || !parts[i - 1].startsWith('## ')).join('\n\n')}\n`;
}

/**
 * Reads a .txt or .md file as a story. Headings split it: one "# Title" first names the story and "##" starts each
 * chapter; with several "#" headings (or none first) each "#" starts a chapter and the file name names the story.
 * With no headings, lines of their own like "Chapter 3" start chapters (how downloads were written before), and
 * otherwise the whole file is one chapter, named by its first line when that stands alone and is short.
 */
export function storyFromText(raw: string, fileName: string): StoryText {
  const lines = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const named = fileName.replace(/\.(txt|text|md|markdown)$/i, '').replace(/[_]+/g, ' ').trim();
  const heads = lines.flatMap((l, i) => {
    const m = OWN_HEAD.test(l) && !l.startsWith('\\') ? HEAD.exec(l) : null;
    return m ? [{ i, level: m[1].length, title: m[2].trim() }] : [];
  });
  const first = lines.findIndex((l) => l.trim());
  let title = named;
  let start = 0;
  let cuts: { i: number; title: string }[] = [];
  if (heads.length) {
    const h1 = heads.filter((x) => x.level === 1);
    if (h1.length === 1 && h1[0].i === first) {
      title = h1[0].title;
      start = first + 1;
      cuts = heads.filter((x) => x.level === 2);
    } else cuts = h1.length ? h1 : heads;
  } else {
    // a line on its own between blank lines: the story's name when it opens the file, a chapter when it reads "Chapter …"
    const alone = (i: number) => !!lines[i]?.trim() && !lines[i - 1]?.trim() && !lines[i + 1]?.trim();
    const marks = lines.flatMap((l, i) => (alone(i) && /^chapter\s+\S.{0,70}$/i.test(l.trim()) ? [{ i, title: l.trim() }] : []));
    if (first >= 0 && alone(first) && lines[first].trim().length <= 120 && !marks.some((m) => m.i === first) && lines.slice(first + 1).some((l) => l.trim())) {
      title = lines[first].trim();
      start = first + 1;
    }
    cuts = marks;
    // a download from before headings ends with Notes on a line of their own
    const notes = marks.length ? lines.findIndex((l, i) => i > marks[marks.length - 1].i && alone(i) && l.trim() === 'Notes') : -1;
    if (notes >= 0) cuts = [...marks, { i: notes, title: NOTES_HEAD }];
  }
  const out: StoryText = { title, chapters: [], notes: '' };
  const lead = tidy(lines.slice(start, cuts[0]?.i ?? lines.length));
  if (lead) out.chapters.push({ title: '', text: heads.length ? unescape(lead) : lead });
  cuts.forEach((c, k) => {
    const body = tidy(lines.slice(c.i + 1, cuts[k + 1]?.i ?? lines.length));
    const text = heads.length ? unescape(body) : body;
    if (k === cuts.length - 1 && c.title.toLowerCase() === NOTES_HEAD.toLowerCase()) out.notes = text;
    else out.chapters.push({ title: c.title, text });
  });
  return out;
}
