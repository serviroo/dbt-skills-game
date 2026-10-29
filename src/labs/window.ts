import { Stage } from '../core/stage';
import { buildVoid } from '../scene/environment';
import { LanternWindow, levelBody, lanternLayer } from '../ui/lantern-window';
import { rankSpec, type RankLetter } from '../ui/rank-reveal';
import { playerName } from '../core/you';

const SAMPLES: Record<string, ConstructorParameters<typeof LanternWindow>[1]> = {
  notification: {
    kind: 'notification',
    title: 'Notification',
    html: `<p>The Lantern has chosen a <b>Wanderer</b>.</p><p>Welcome, ${playerName()}.</p>`,
    tapToContinue: true,
  },
  level: {
    kind: 'level',
    icon: 'level',
    title: 'Notification',
    html: levelBody(
      'LEVEL UP',
      [
        ['Strength', 'already high'],
        ['Patience', 'growing'],
        ['Kindness', 'S-rank'],
      ],
      'Tutorial cleared.<br>All stats were already high. The Lantern is just making it official.',
    ),
    tapToContinue: true,
  },
  reward: {
    kind: 'reward',
    title: 'Reward',
    html: `<p class="center">Reward unlocked.</p>`,
    actions: [{ label: 'Open', value: 'open', variant: 'gold' }],
  },
  quest: {
    kind: 'quest',
    title: "Today's Quest",
    html: `<p class="center"><b>Wise Mind</b></p><div class="sw-rows"><div class="sw-row"><span class="k">Three slow breaths</span><span class="v">[0/3]</span></div><div class="sw-row"><span class="k">Name one feeling</span><span class="v">[0/1]</span></div></div>`,
    actions: [{ label: 'Start', value: 'start' }, { label: 'Later', value: 'later', variant: 'quiet' }],
  },
};

export function windowLab(stage: Stage) {
  const q = new URLSearchParams(location.search);
  const env = buildVoid();
  env.skyMat.uniforms.uGlow.value = 0.25;
  env.ground.visible = false;
  stage.scene.add(env.group);
  stage.camera.position.set(0, 1.4, 4);
  stage.camera.lookAt(0, 1.6, -10);
  const kind = q.get('kind') ?? 'notification';
  if (['title', 'awaken', 'rewards', 'letter', 'endcard', 'hold'].includes(kind)) {
    env.skyMat.uniforms.uGlow.value = 0.25;
    overlayDemo(kind, stage);
    return;
  }
  const RANK_LINES: Record<string, string> = {
    E: 'E-Rank. Every Wanderer starts here.',
    D: 'D-Rank. The practice is showing.',
    C: 'C-Rank. The skills are starting to feel familiar. That is how it works.',
    B: 'B-Rank. Steady work, on your own terms.',
    A: 'A-Rank. Not because anything was perfect. Because you kept practising, your way.',
    S: 'S-Rank. The strength was there from the start. Now it is official.',
    M: 'Title unlocked: Night Warden. The Night Watch answers to you.',
  };
  const letter = (q.get('letter') ?? 'C').toUpperCase() as RankLetter;
  const spec = kind === 'rank' ? rankSpec(letter, RANK_LINES[letter] ?? RANK_LINES.C) : (SAMPLES[kind] ?? SAMPLES.notification);
  const w = new LanternWindow(lanternLayer(), spec);
  const delay = Number(q.get('delay') ?? 0.3);
  setTimeout(() => w.open(), q.has('capture') ? 0 : delay * 1000);
  (window as any).__win = w;
}

export async function overlayDemo(kind: string, stage: Stage) {
  // the chest's hold to open, alone on the light stage: no chest to draw, so it shows at once on any renderer
  if (kind === 'hold') {
    const { holdToCharge } = await stage.loading(import('../scene/chest/hold'));
    return holdToCharge({ onProgress: () => {}, onFrame: (fn) => stage.onUpdate(() => fn()) });
  }
  // a capture's clock holds while the overlay's modules load; the overlay itself then plays on that clock
  const [ui, { REWARDS }] = await stage.loading(Promise.all([import('../ui/cutscene-ui'), import('../content/intro')]));
  if (kind === 'title') return ui.showTitle();
  if (kind === 'awaken') return ui.awakenWord('AWAKEN', 30);
  if (kind === 'rewards') return ui.rewardCards(REWARDS);
  if (kind === 'letter') return ui.letterView();
  if (kind === 'endcard') return ui.endCard();
}
