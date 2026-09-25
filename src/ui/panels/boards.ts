import type { Boards, Island } from '../../net/island';
import { deedLevel, MAX_DEED_LEVEL, type Game } from '../../game/game';
import { BOARD_TOP, bestSkill, bredScore } from '../../game/boards';
import { creatureLevel, SPECIES, type Creature } from '../../game/creatures';
import { SKILL_BY_ID, SKILL_DEFS, type SkillDef } from '../../game/skills';
import { GRADE_STEP, TIERS, TRAIT_SLOTS } from '../../game/traits';
import type { UIWindow } from '../windows';

/** How often the window asks the island again while it is open, in seconds. */
export const REFRESH = 30;

type Tab = 'skills' | 'wildermon' | 'settlements';

/** A figure as a board prints it: a whole number bare, anything else to one place. */
export const figure = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The most a wildermon can score: every trait it carries at the top grade. */
export const BRED_MAX = TRAIT_SLOTS * GRADE_STEP[TIERS[TIERS.length - 1]];

/**
 * What each board ranks by: the line the window prints over it, which the
 * help repeats. Every number in them is read off the rule it describes, and
 * `supabase/test/boards.ts` holds them to the island's copies of those rules.
 */
export const BOARD_RULES: Record<Tab, string> = {
  skills: `Each skill's top ${BOARD_TOP} on the island, by skill level. Only somebody who has raised a skill is ranked in it.`,
  wildermon: `Top ${BOARD_TOP} tamed wildermon by their traits added up, each by its grade: `
    + `${TIERS.map((t) => `${t} ${figure(GRADE_STEP[t])}`).join(', ')}, so ${figure(BRED_MAX)} at most for ${TRAIT_SLOTS} traits. `
    + 'A tie goes to the higher level. Wild ones are not ranked, and no trait is named.',
  settlements: `Top ${BOARD_TOP} settlements by level (1 to ${MAX_DEED_LEVEL}), then citizens (the founder and everybody on the roll), `
    + 'then age, oldest first.',
};

const TABS: Array<[Tab, string, string]> = [
  ['skills', 'Skills', 'Who holds each skill highest'],
  ['wildermon', 'Wildermon', 'The best-bred tamed wildermon'],
  ['settlements', 'Settlements', 'The biggest settlements'],
];

/** The Skills window's order, so a skill is found where it always is. */
const SKILL_GROUPS: Array<SkillDef['group']> = ['Characteristics', 'Fighting', 'Skills'];

/** How many people a settlement holds, as a board says it. */
const citizens = (n: number): string => `${n} ${n === 1 ? 'citizen' : 'citizens'}`;

/**
 * Your own standing on each board, for the game you play by yourself: your
 * best skill, your best-bred wildermon and your settlement, each measured the
 * way the island's board measures it.
 */
export function soloStanding(game: Game): Record<Tab, string> {
  const skill = bestSkill((id) => game.skills.get(id));
  let bred: { c: Creature; score: number } | null = null;
  for (const c of game.creatures.list.values()) {
    if (c.mode === 'wild') continue;
    const score = bredScore(c.traits);
    if (!bred || score > bred.score || (score === bred.score && creatureLevel(c) > creatureLevel(bred.c))) bred = { c, score };
  }
  const deed = game.deed;
  return {
    skills: skill
      ? `Your best skill, characteristics not counted: ${SKILL_BY_ID.get(skill.id)?.name ?? skill.id} ${skill.value.toFixed(2)}.`
      : 'You have not raised a skill yet, characteristics not counted.',
    wildermon: bred
      ? `Your best-bred wildermon: ${bred.c.name}, ${SPECIES[bred.c.species]?.name ?? bred.c.species}, `
        + `at ${figure(bred.score)} of ${figure(BRED_MAX)}, level ${creatureLevel(bred.c)}.`
      : 'You have no tamed wildermon.',
    settlements: deed
      ? `Your settlement: ${deed.name}, level ${deedLevel(deed)} of ${MAX_DEED_LEVEL}, ${citizens(1)}: you.`
      : 'You have not founded a settlement.',
  };
}

/**
 * Who leads the island: each skill's highest, the best-bred wildermon and the
 * biggest settlements.
 *
 * All three come from one ask (`rpc_boards`), made when the window opens and
 * every `REFRESH` seconds while it stays open, and never while it is shut. The
 * page is only rebuilt when the answer has changed, so a skill list somebody
 * is in the middle of choosing from is not pulled out from under them.
 *
 * In the game you play by yourself there is nobody to rank against, so the
 * window says what a board ranks by and where you would stand on it.
 */
export class BoardsPanel {
  private readonly bar: HTMLDivElement;
  private readonly page: HTMLDivElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'skills';
  /** The last answer, the same as text to tell whether the next one differs, and whether the latest ask came back empty. */
  private seen: Boards | null = null;
  private seenKey = '';
  private failed = false;
  /** The skill whose board is showing; kept across answers while it has one. */
  private skill: string | null = null;
  private asking = false;
  private lastAsk = -1e9;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    win.body.classList.add('skills-body');
    this.bar = document.createElement('div');
    this.bar.className = 'log-tabs';
    for (const [id, label, title] of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tb-btn tb-small log-tab${id === this.tab ? ' tb-on' : ''}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, b);
      this.bar.append(b);
    }
    // Alone there is one page, not three boards to choose between.
    this.bar.hidden = !island;
    this.page = document.createElement('div');
    win.body.append(this.bar, this.page);
    win.onOpen = () => void this.refresh(performance.now() / 1000);
    this.draw();
  }

  private show(id: Tab): void {
    this.tab = id;
    for (const [key, el] of this.tabs) el.classList.toggle('tb-on', key === id);
    this.draw();
  }

  /** Asked again while the window is open, and not at all while it is shut. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastAsk < REFRESH) return;
    void this.refresh(now);
  }

  private async refresh(now: number): Promise<void> {
    this.lastAsk = now;
    if (!this.island) {
      this.draw();
      return;
    }
    if (this.asking) return;
    this.asking = true;
    let got: Boards | null = null;
    try {
      got = await this.island.boards();
    } finally {
      this.asking = false;
    }
    const key = got ? JSON.stringify(got) : this.seenKey;
    if (got && key === this.seenKey && !this.failed) return;
    this.failed = !got;
    if (got) {
      this.seen = got;
      this.seenKey = key;
    }
    this.draw();
  }

  private draw(): void {
    this.page.replaceChildren();
    if (!this.island) {
      this.drawAlone();
      return;
    }
    this.say(BOARD_RULES[this.tab]);
    if (!this.seen) {
      this.say(this.failed ? 'The island did not answer. It is asked again every '
        + `${REFRESH} seconds while this window is open.` : 'Asking the island…');
      return;
    }
    if (this.failed) this.say(`The island did not answer just now, so this is its last answer. It is asked again every ${REFRESH} seconds.`);
    if (this.tab === 'skills') this.drawSkills(this.seen);
    else if (this.tab === 'wildermon') this.drawWildermon(this.seen);
    else this.drawSettlements(this.seen);
  }

  /** The game you play by yourself: what each board ranks by, and where you stand on it. */
  private drawAlone(): void {
    this.say('Leaderboards rank the people on an island against one another. There is nobody else in '
      + 'this game, so here is what each board ranks by and where you stand on it.');
    const mine = soloStanding(this.game);
    for (const [id, label] of TABS) {
      this.head(label);
      this.say(BOARD_RULES[id]);
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.textContent = mine[id];
      this.page.append(row);
    }
  }

  private drawSkills(b: Boards): void {
    const known = SKILL_GROUPS.map((g) => [g, SKILL_DEFS.filter((d) => d.group === g && b.skills[d.id]?.length)] as const)
      .filter(([, defs]) => defs.length);
    if (!known.length) {
      this.say('Nobody on this island has raised a skill yet.');
      return;
    }
    // The one you had, while it still has a board; else your own best, if it
    // has one; else the first there is.
    const has = (id: string | null): id is string => !!id && !!b.skills[id]?.length;
    const own = bestSkill((id) => this.game.skills.get(id))?.id ?? null;
    const shown = has(this.skill) ? this.skill : has(own) ? own : known[0][1][0].id;
    this.skill = shown;
    const pick = document.createElement('select');
    pick.className = 'panel-select';
    pick.title = 'Which skill to show, with who holds it highest';
    for (const [group, defs] of known) {
      const og = document.createElement('optgroup');
      og.label = group;
      for (const d of defs) {
        const top = b.skills[d.id][0];
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = `${d.name} — ${top.name} ${top.value.toFixed(2)}`;
        o.selected = d.id === shown;
        og.append(o);
      }
      pick.append(og);
    }
    pick.addEventListener('change', () => {
      this.skill = pick.value;
      this.draw();
    });
    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    bar.append(pick);
    this.page.append(bar);
    b.skills[shown].forEach((p, i) => this.place(i + 1, p.name, '', p.value.toFixed(2), p.mine));
  }

  private drawWildermon(b: Boards): void {
    if (!b.wildermon.length) {
      this.say('Nobody on this island has a tamed wildermon yet.');
      return;
    }
    b.wildermon.forEach((w, i) => this.place(i + 1, `${w.name}, ${SPECIES[w.species]?.name ?? w.species}`,
      w.keeper, figure(w.score), w.mine, `Its traits add up to ${figure(w.score)} of ${figure(BRED_MAX)}`));
  }

  private drawSettlements(b: Boards): void {
    if (!b.settlements.length) {
      this.say('Nobody on this island has founded a settlement yet.');
      return;
    }
    b.settlements.forEach((s, i) => this.place(i + 1, s.name, `${s.founder}'s · ${citizens(s.citizens)}`,
      `level ${s.level}`, s.mine));
  }

  /** One place on a board: its number, who or what, a note, and the figure it is ranked by. */
  private place(n: number, who: string, note: string, fig: string, mine: boolean, title = ''): void {
    const row = document.createElement('div');
    row.className = `skill-row board-row${mine ? ' board-mine' : ''}`;
    const rank = document.createElement('span');
    rank.className = 'board-rank';
    rank.textContent = `${n}.`;
    const name = document.createElement('span');
    name.textContent = who;
    const aside = document.createElement('span');
    aside.className = 'skill-note';
    aside.textContent = note;
    const value = document.createElement('span');
    value.className = 'skill-value';
    value.textContent = fig;
    if (title) value.title = title;
    row.append(rank, name, aside, value);
    this.page.append(row);
  }

  private say(text: string): void {
    const el = document.createElement('div');
    el.className = 'skill-note market-note';
    el.textContent = text;
    this.page.append(el);
  }

  private head(text: string): void {
    const el = document.createElement('div');
    el.className = 'skill-group';
    el.textContent = text;
    this.page.append(el);
  }
}
