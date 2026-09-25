/**
 * Numbers as they are said.
 *
 * Text the player reads states the exact benefit, and where the number can be
 * derived it is derived rather than written out, so the words cannot drift
 * from the rule they describe (`CLAUDE.md`). Prose wants "three planks" and
 * "a fifth faster" rather than "3 planks" and "+20%", and these are what turn
 * the rule's own number into those words.
 *
 * Data in, words out, and nothing imported: anything may read it, the
 * definitions dump included.
 */

const ONES = [
  'nought', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Below a hundred. */
const small = (n: number): string =>
  n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;

/** Below a thousand: "a hundred", "a hundred and forty", "two hundred and fifty". */
const hundreds = (n: number): string => {
  if (n < 100) return small(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return `${h === 1 ? 'a' : small(h)} hundred${rest ? ` and ${small(rest)}` : ''}`;
};

/**
 * A whole number in words: 3 is "three", 64 "sixty-four", 100 "a hundred",
 * 1500 "fifteen hundred", 10000 "ten thousand". Anything that is not a whole
 * number, or is past a million, is left in figures, which is how the island
 * would say it anyway.
 */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1_000_000) return String(n);
  if (n < 1000) return hundreds(n);
  // Twelve hundred and fifteen hundred, as a carter would say them.
  if (n < 10000 && Math.floor(n / 100) % 10 !== 0) {
    return `${small(Math.floor(n / 100))} hundred${n % 100 ? ` and ${small(n % 100)}` : ''}`;
  }
  const k = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = k === 1 ? 'a thousand' : `${hundreds(k)} thousand`;
  if (!rest) return head;
  return `${head}${rest < 100 ? ' and ' : ' '}${hundreds(rest)}`;
}

/** The first letter up, for the start of a sentence. */
export const capital = (s: string): string => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/** `numberWord`, at the start of a sentence: "Three to a lump." */
export const NumberWord = (n: number): string => capital(numberWord(n));

/** "a" or "an", by the word after it: an eighth, a hundred, an hour, a one. */
export const article = (word: string): string =>
  (/^(one|uni|use|eu)/i.test(word) ? 'a' : /^(hour|honest|heir|[aeiou])/i.test(word) ? 'an' : 'a');

const PARTS: Record<number, [string, string]> = {
  2: ['half', 'halves'], 3: ['third', 'thirds'], 4: ['quarter', 'quarters'], 5: ['fifth', 'fifths'],
  6: ['sixth', 'sixths'], 7: ['seventh', 'sevenths'], 8: ['eighth', 'eighths'], 9: ['ninth', 'ninths'],
  10: ['tenth', 'tenths'], 12: ['twelfth', 'twelfths'], 20: ['twentieth', 'twentieths'],
  100: ['hundredth', 'hundredths'],
};

/**
 * A part of a whole in words, when it is exactly one: 0.2 is "a fifth", 0.75
 * "three quarters", 0.4 "two fifths", 0.5 "half". A share that is no simple
 * fraction is given as a percentage rather than rounded to the nearest one --
 * 0.16 is "16%", not "a sixth" -- because the point is the exact number.
 */
export function share(x: number): string {
  for (const d of Object.keys(PARTS).map(Number)) {
    const n = Math.round(x * d);
    // Three twentieths is nobody's way of saying fifteen per cent.
    if (n < 1 || n >= d || (n > 1 && d > 10) || Math.abs(x * d - n) > 1e-6) continue;
    if (d === 2) return 'half';
    const [one, many] = PARTS[d];
    return n === 1 ? `${article(one)} ${one}` : `${numberWord(n)} ${many}`;
  }
  return `${percent(x)}`;
}

/** A share as a percentage, to the nearest whole one unless that would lose it: "16%", "2.5%". */
export const percent = (x: number): string => {
  const p = x * 100;
  const whole = Math.round(p);
  return `${Math.abs(p - whole) < 1e-6 ? whole : Number(p.toFixed(1))}%`;
};

/**
 * A multiplier in words: 2 is "twice", 1.5 "half again", 3 "three times", 30
 * "thirty times", 1.25 "a quarter again". Past two it counts the times; below
 * it, it says what is added on top.
 */
export function times(m: number): string {
  if (Math.abs(m - 2) < 1e-9) return 'twice';
  const whole = Math.round(m);
  if (whole > 2 && Math.abs(m - whole) < 1e-9) return `${numberWord(whole)} times`;
  if (m > 1 && m < 2) return `${share(m - 1)} again`;
  return `${Number(m.toFixed(1))} times`;
}

/** Minutes in words, with the quarters of an hour said the way they are said. */
const minutes = (m: number): string => {
  if (m === 15) return 'a quarter of an hour';
  if (m === 30) return 'half an hour';
  if (m === 45) return 'three quarters of an hour';
  return `${numberWord(m)} minute${m === 1 ? '' : 's'}`;
};

/**
 * A stretch of time in words, from the seconds a rule is written in: 720 is
 * "twelve minutes", 150 "two and a half minutes", 1800 "half an hour", 4500
 * "an hour and a quarter", 10800 "three hours". To the half minute under ten
 * minutes, the nearest minute past that, and the nearest quarter of an hour
 * past two hours, which is as close as anybody would say it.
 */
export function spanWords(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 90) return `${numberWord(s)} second${s === 1 ? '' : 's'}`;
  // Under ten minutes a half minute is worth saying: "two and a half minutes".
  if (s < 600 && s % 60 === 30) return s === 90 ? 'a minute and a half' : `${numberWord((s - 30) / 60)} and a half minutes`;
  const m = Math.round(s / 60);
  if (m < 60) return minutes(m);
  if (m % 60 === 0 || m >= 120) {
    const q = Math.round(m / 15);
    const h = Math.floor(q / 4);
    const part = ['', 'a quarter', 'a half', 'three quarters'][q % 4];
    if (!part) {
      if (h >= 24 && h % 24 === 0) return h === 24 ? 'a day' : `${numberWord(h / 24)} days`;
      return h === 1 ? 'an hour' : `${numberWord(h)} hours`;
    }
    return h === 1 ? `an hour and ${part}` : `${numberWord(h)} and ${part} hours`;
  }
  // Between one and two hours, to the minute where it is not a quarter.
  const past = m - 60;
  if (past % 15 === 0) return `an hour and ${past === 30 ? 'a half' : past === 15 ? 'a quarter' : 'three quarters'}`;
  return `an hour and ${minutes(past)}`;
}

/** "a, b and c", for a list somebody reads rather than parses. */
export const listed = (xs: readonly string[]): string =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * A definition's text with its own numbers put into it.
 *
 * An item or a piece is written in one object literal, which cannot name its
 * own fields, so its text names them instead and this fills them in once the
 * definition is whole: `{holds}` is the field as it stands, `{holds:w}` the
 * same in words, `{holds:W}` in words at the start of a sentence,
 * `{shelter:share}` as a part of a whole, `{food:pct}` as a percentage,
 * `{trash:times}` as a multiplier and `{time:span}` as a stretch of time.
 * A dotted key reaches into the thing (`{vehicle.yokes:w}`).
 *
 * A key the thing does not have is left where it is, for whichever module
 * holds that number to fill in; `benefit.ts` checks that none is left over.
 */
export function fill(text: string, from: object): string {
  return text.replace(/\{([\w.]+)(?::(\w+))?\}/g, (whole, key: string, how: string | undefined) => {
    let v: unknown = from;
    for (const k of key.split('.')) v = v === null || v === undefined ? undefined : (v as Record<string, unknown>)[k];
    if (typeof v === 'string') return v;
    if (typeof v !== 'number') return whole;
    switch (how) {
      case 'w': return numberWord(v);
      case 'W': return NumberWord(v);
      case 'share': return share(v);
      case 'pct': return percent(v);
      case 'times': return times(v);
      case 'span': return spanWords(v);
      default: return String(v);
    }
  });
}
