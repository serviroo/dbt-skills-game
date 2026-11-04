import { h, keptWhole, p } from './ui';

const pageTitle = (text: string) => keptWhole(h('h1', { class: 'dq-h1', 'data-focus': '', text }));

export const pageHead = (title: string, sub?: string) =>
  h('header', { class: 'dq-pagehead' }, pageTitle(title), sub ? p(sub, 'dq-text dq-pagesub') : null);

export const restHead = (kicker: string, title: string, sub: string) =>
  h(
    'header',
    { class: 'dq-pagehead dq-st-head' },
    h('p', { class: 'dq-st-kicker', text: kicker }),
    pageTitle(title),
    p(sub, 'dq-text dq-pagesub dq-st-sub'),
  );

export const storyHead = (title: string, sub: string, extra?: HTMLElement | null) =>
  h(
    'header',
    { class: 'dq-pagehead st-head' },
    h('div', { class: 'st-head-row' }, pageTitle(title), extra ?? null),
    p(sub, 'dq-text dq-pagesub'),
  );
