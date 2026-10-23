/**
 * Crisis lines by country, checked 2026-10-23 against each service's own site, or an official government page where
 * that was the source that could be read (emergency numbers, Ireland's 50808 on the HSE, India's 181). A number that
 * couldn't be confirmed from one of those is left out, and so is a cost or name the source didn't state.
 */
export type RegionId = 'us' | 'ca' | 'uk' | 'ie' | 'au' | 'nz' | 'in' | 'elsewhere';

export interface CrisisLine {
  name: string;
  how: string;
  links: { label: string; href: string; body?: string }[];
}

export interface Region {
  id: RegionId;
  name: string;
  /** Emergency numbers, first one shown first. Empty for "Somewhere else". */
  emergency: string[];
  lines: CrisisLine[];
}

export const REGIONS: Region[] = [
  {
    id: 'us',
    name: 'United States',
    emergency: ['911'],
    lines: [
      { name: '988 Suicide & Crisis Lifeline', how: 'Call or text 988. Free, confidential, 24/7.', links: [{ label: 'Call 988', href: 'tel:988' }, { label: 'Text 988', href: 'sms:988' }] },
      { name: 'Crisis Text Line', how: 'Text HOME to 741741. Free, 24/7.', links: [{ label: 'Text HOME to 741741', href: 'sms:741741', body: 'HOME' }] },
      { name: 'National Domestic Violence Hotline', how: 'For anyone feeling unsafe with someone. Call 1-800-799-7233, or text START to 88788. Free, 24/7.', links: [{ label: 'Call', href: 'tel:18007997233' }, { label: 'Text START', href: 'sms:88788', body: 'START' }] },
    ],
  },
  {
    id: 'ca',
    name: 'Canada',
    emergency: ['911'],
    lines: [
      { name: '9-8-8: Suicide Crisis Helpline', how: "Call or text 988, any time, in English or French. Calls are toll-free. Your carrier's usual text rates may apply.", links: [{ label: 'Call 988', href: 'tel:988' }, { label: 'Text 988', href: 'sms:988' }] },
    ],
  },
  {
    id: 'uk',
    name: 'United Kingdom',
    emergency: ['999'],
    lines: [
      { name: 'Samaritans', how: 'Call 116 123. Free from any phone, day or night.', links: [{ label: 'Call 116 123', href: 'tel:116123' }] },
      { name: 'Shout', how: 'Text SHOUT to 85258. Free, confidential, 24/7.', links: [{ label: 'Text SHOUT to 85258', href: 'sms:85258', body: 'SHOUT' }] },
    ],
  },
  {
    id: 'ie',
    name: 'Ireland',
    emergency: ['112', '999'],
    lines: [
      { name: 'Samaritans', how: 'Call 116 123. Free, day or night.', links: [{ label: 'Call 116 123', href: 'tel:116123' }] },
      { name: 'Text 50808', how: 'Text HELLO to 50808. Free and anonymous, any time.', links: [{ label: 'Text HELLO to 50808', href: 'sms:50808', body: 'HELLO' }] },
      { name: "Women's Aid", how: 'Domestic abuse helpline. Freephone 1800 341 900, 24/7.', links: [{ label: 'Call', href: 'tel:1800341900' }] },
    ],
  },
  {
    id: 'au',
    name: 'Australia',
    emergency: ['000'],
    lines: [
      { name: 'Lifeline', how: 'Call 13 11 14 or text 0477 13 11 14, 24/7. Calls from mobiles are free.', links: [{ label: 'Call 13 11 14', href: 'tel:131114' }, { label: 'Text', href: 'sms:0477131114' }] },
      { name: '1800RESPECT', how: 'Family, domestic and sexual violence support. Call 1800 737 732 or text 0458 737 732. Free, 24/7.', links: [{ label: 'Call', href: 'tel:1800737732' }, { label: 'Text', href: 'sms:0458737732' }] },
    ],
  },
  {
    id: 'nz',
    name: 'New Zealand',
    emergency: ['111'],
    lines: [
      { name: '1737', how: 'Call or text 1737. Free, 24/7.', links: [{ label: 'Call 1737', href: 'tel:1737' }, { label: 'Text 1737', href: 'sms:1737' }] },
      { name: "Women's Refuge", how: 'Family violence crisisline. Call 0800 733 843, free, 24 hours.', links: [{ label: 'Call', href: 'tel:0800733843' }] },
    ],
  },
  {
    id: 'in',
    name: 'India',
    emergency: ['112'],
    lines: [
      { name: 'Tele-MANAS', how: 'Mental health support from the Ministry of Health. Call 14416, toll-free, 24/7.', links: [{ label: 'Call 14416', href: 'tel:14416' }] },
      { name: 'Women Helpline', how: 'For women. Call 181, toll-free, 24 hours, in every state except West Bengal.', links: [{ label: 'Call 181', href: 'tel:181' }] },
    ],
  },
  { id: 'elsewhere', name: 'Somewhere else', emergency: [], lines: [] },
];

const BY_COUNTRY: Record<string, RegionId> = { US: 'us', CA: 'ca', GB: 'uk', UK: 'uk', IE: 'ie', AU: 'au', NZ: 'nz', IN: 'in' };

/** The first device language whose country has lines here (en-GB gives the UK), else "Somewhere else". */
export function regionFromLocale(langs: readonly string[]): RegionId {
  for (const l of langs) {
    const country = l.split(/[-_]/).slice(1).find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
    if (country && BY_COUNTRY[country]) return BY_COUNTRY[country];
  }
  return 'elsewhere';
}

export const regionById = (id: string) => REGIONS.find((r) => r.id === id) ?? REGIONS[REGIONS.length - 1];

export const CRISIS_CHECKED = '2026-10-23';
