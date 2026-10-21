import { Stage } from '../core/stage';
import { buildVoid } from '../scene/environment';
import { SystemWindow, levelBody, systemLayer } from '../ui/system-window';
import { rankSpec, type RankLetter } from '../ui/rank-reveal';

const SAMPLES: Record<string, ConstructorParameters<typeof SystemWindow>[1]> = {
  notification: {
    kind: 'notification',
    title: 'Notification',
    html: `<p>You have acquired the qualifications to be a <b>Player</b>.</p><p>Welcome, Player.</p>`,
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
        ['Honesty', 'rare stat'],
        ['Sleepiness', 'max'],
      ],
      'Tutorial cleared.<br>All stats were already high. The System is just making it official.',
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
    title: 'Daily Quest',
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
  if (['title', 'arise', 'rewards', 'letter', 'endcard'].includes(kind)) {
    env.skyMat.uniforms.uGlow.value = 0.25;
    overlayDemo(kind);
    return;
  }
  const RANK_LINES: Record<string, string> = {
    E: 'E-Rank. Every Hunter starts here.',
    D: 'D-Rank. The practice is showing.',
    C: 'C-Rank. The skills are starting to feel familiar. That is how it works.',
    B: 'B-Rank. Steady work, on your own terms.',
    A: 'A-Rank. Not because anything was perfect. Because you kept practising, your way.',
    S: 'S-Rank. The strength was there from the start. Now it is official.',
    M: 'Title unlocked: Shadow Monarch. The shadows answer to you.',
  };
  const letter = (q.get('letter') ?? 'C').toUpperCase() as RankLetter;
  const spec = kind === 'rank' ? rankSpec(letter, RANK_LINES[letter] ?? RANK_LINES.C) : (SAMPLES[kind] ?? SAMPLES.notification);
  const w = new SystemWindow(systemLayer(), spec);
  const delay = Number(q.get('delay') ?? 0.3);
  setTimeout(() => w.open(), q.has('capture') ? 0 : delay * 1000);
  (window as any).__win = w;
}

export async function overlayDemo(kind: string) {
  const ui = await import('../ui/cutscene-ui');
  const { REWARDS } = await import('../content/intro');
  if (kind === 'title') return ui.showTitle();
  if (kind === 'arise') return ui.ariseWord('ARISE', 30);
  if (kind === 'rewards') return ui.rewardCards(REWARDS);
  if (kind === 'letter') return ui.letterView();
  if (kind === 'endcard') return ui.endCard();
}
