// The harness's until() waits for a check in the page that awaits something, and gives up at its deadline even when the
// check never answers.

export const scenarios = {
  async 'until-hung-check-fails'(h) {
    const ctx = await h.browser.newContext();
    try {
      const page = await ctx.newPage();
      const hung = await Promise.race([h.until(page, () => new Promise(() => {}), null, { timeout: 500 }).then(() => 'answered', (e) => e.message), h.sleep(3000).then(() => 'still waiting after 3 s')]);
      h.expect(/^waited 500 ms for /.test(hung), `a check that never answers did not fail at its deadline: ${hung}`);
      const late = await h.until(page, () => new Promise((r) => setTimeout(() => r(true), 300)), null, { timeout: 2000 }).then(() => 'answered', (e) => e.message);
      h.expect(late === 'answered', `a check that answered before its deadline failed: ${late}`);
    } finally { await ctx.close(); }
  },
};
