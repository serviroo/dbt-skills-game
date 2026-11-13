export async function recordLiveNote(page, screen, region, text, edit = false) {
  await page.evaluate(({ screen, region, text, edit }) => {
    const record = (window.__liveNote = { frame: 0, shown: null, edited: null, insertions: [], nodes: [] });
    const tick = () => {
      record.frame++;
      const el = document.querySelector(screen);
      if (record.shown === null && el && !el.inert && getComputedStyle(el).visibility !== 'hidden') {
        record.shown = record.frame;
        if (edit) {
          const note = el.querySelector(region);
          const node = [...(note?.childNodes ?? [])]
            .find((child) => child.nodeType === Node.TEXT_NODE && child.data.includes(text));
          if (node) {
            node.data = 'A newer note.';
            record.edited = record.frame;
          }
        }
      }
      record.raf = requestAnimationFrame(tick);
    };
    const observer = new MutationObserver((changes) => {
      for (const change of changes) {
        if (!(change.target instanceof Element) || !change.target.matches(region)) continue;
        for (const node of change.addedNodes) {
          if (!node.textContent.includes(text) && !(edit && record.edited !== null)) continue;
          const same = record.nodes.includes(node);
          record.nodes.push(node);
          record.insertions.push({ frame: record.frame, same });
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true });
    record.stop = () => { observer.disconnect(); cancelAnimationFrame(record.raf); };
    record.raf = requestAnimationFrame(tick);
  }, { screen, region, text, edit });
}

export async function expectEditedLiveNote(h, page, label) {
  await page.waitForFunction(() => window.__liveNote.shown !== null, null, { timeout: 5000 });
  await h.frames(page, 4);
  const result = await page.evaluate(() => {
    const { shown, edited, insertions, stop } = window.__liveNote;
    stop();
    return { shown, edited, insertions };
  });
  h.expect(result.edited === result.shown && result.insertions.some((i) => i.frame < result.shown),
    `${label}: the hidden note was not edited as the page came in: ${JSON.stringify(result)}`);
  h.expect(!result.insertions.some((i) => i.frame > result.edited),
    `${label}: the edited note was inserted again: ${JSON.stringify(result)}`);
}

export async function expectLiveNote(h, page, label) {
  await page.waitForFunction(() => window.__liveNote.shown !== null, null, { timeout: 5000 });
  await h.frames(page, 4);
  const result = await page.evaluate(() => {
    const { shown, insertions, stop } = window.__liveNote;
    stop();
    return { shown, insertions };
  });
  h.expect(result.insertions.some((i) => i.same && i.frame > result.shown),
    `${label}: the same note was not inserted after the page came in: ${JSON.stringify(result)}`);
}
