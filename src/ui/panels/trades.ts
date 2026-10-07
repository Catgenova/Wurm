import type { Game } from '../../game/game';
import type {
  ChannelCard, ClassCard, ClassesSaid, Island, RiteCard, TreeNode, TreePerk, TreeSaid, TreeTier, TreeTrade,
} from '../../net/island';
import { SKILL_DEFS } from '../../game/skills';
import { REGRET } from '../../game/baubles';
import {
  CHANNELS, CLASS_CHANGE_COST, CLASS_COLUMNS, CLASS_NODES, CLASS_POINTS_MAX, CLASS_TIER_AT, CLASSES, classDef, classOpen,
  classPoints, PERK_CLASSES, RITES, tiersAtFor,
} from '../../game/classes';
import type { ClassDef } from '../../game/classes';
import { perksOf } from '../../game/perks';
import { CLASS_LEVEL_START } from '../../game/talents';
import { article, listed, numberWord } from '../../game/words';
import type { UIWindow } from '../windows';

/**
 * The trades: which one is yours, the nine nodes behind it, and its rite.
 *
 * Every one of these doors has existed for a day with nothing drawing it.
 * `rpc_classes` says what may be taken, `rpc_tree` says what has been bought
 * and what it came to, and `rpc_take_class`, `rpc_take_node` and `rpc_rite`
 * are how a person spends any of it. This is the window.
 *
 * ## Nothing about you is worked out here
 *
 * The browser has no idea which trade is yours, how many points it has earned,
 * what you have spent, what is in your purse or whether the altar will hear
 * you. All of that is the island's, and asking is the whole design: the island
 * is the authority, the browser asks and listens.
 *
 * So each door answers with what to draw *and* with its own refusal. A node
 * arrives carrying `why`, a rite arrives carrying `why`, and this window puts
 * that sentence under the button rather than guessing at the rule. There is
 * exactly one place that decides whether you may buy a node, and it is not
 * here.
 *
 * ## What a trade offers is read from the rulebook
 *
 * What a trade *offers* is the same for everybody, and it is written in
 * `src/game/classes.ts` and `src/game/perks.ts`, which are what generated the
 * island's rows. So any card can lay open its six tiers of perks, or its rite
 * and its tree, before the trade is taken up, on an island or playing alone.
 * That is a reading and nothing more: the button that takes the trade up is
 * still the island's, and so is the sentence under it.
 *
 * ## Asked twice where it cannot be taken back
 *
 * Taking up a trade and taking a perk are undone only by silver or by a Bauble
 * of Regret, so neither happens on one press. The first press says what the
 * second will do in so many words: what is put down, what it costs, and which
 * perks close. The second does it.
 *
 * ## Two tabs, because there are two questions
 *
 * **Trades** is the question you ask once and rarely again: which of the
 * twenty-four is mine. **Tree** is the one you come back to every few levels:
 * what do I spend this on. A rite belongs to a trade rather than to a list, so
 * it sits at the head of that trade's tree rather than in a third tab -- there
 * are at most two of them, and they are the first thing you want when you open
 * the window mid-fight.
 */

/** How often the window asks again while it is open, in seconds. */
const REFRESH = 4;

type Tab = 'trades' | 'tree';

const GROUPS: Array<['craft' | 'combat', string]> = [['craft', 'Crafting'], ['combat', 'Fighting']];

export class TradesPanel {
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly page: HTMLDivElement;
  private tab: Tab = 'trades';

  private said: ClassesSaid | null = null;
  private tree: TreeSaid | null = null;
  /** One ask at a time, and not twice a frame. */
  private asking = false;
  private lastAsk = -1e9;
  /** An ask wanted while one was already out, so the answer after a choice is never a stale one. */
  private again = false;
  /**
   * The last answer drawn, as text. The window asks every few seconds, and
   * redrawing an unchanged answer throws away the button under the pointer
   * and the one with the keyboard on it.
   */
  private seen = '';

  /** The trades laid open under their cards, which a redraw keeps open. */
  private readonly opened = new Set<string>();
  /** The one choice waiting on its second press: `class:<id>` or `perk:<id>`. */
  private confirming: string | null = null;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
    /** Told after every choice made here: a fighting trade's spell taken, or the trade put down, changes the spell bar. */
    private readonly changed: () => void = () => {},
  ) {
    win.body.classList.add('trade-body');
    const bar = document.createElement('div');
    bar.className = 'trade-tabs';
    for (const [id, label] of [['trades', 'Trades'], ['tree', 'Tree']] as Array<[Tab, string]>) {
      const b = button(label);
      b.addEventListener('click', () => this.show(id));
      this.tabs.set(id, b);
      bar.append(b);
    }
    this.page = document.createElement('div');
    this.page.className = 'trade-page';
    win.body.append(bar, this.page);

    win.onOpen = () => {
      this.lastAsk = -1e9;
      this.draw();
      void this.ask();
    };
    this.draw();
  }

  /**
   * Asked on a clock while the window is up, because a rite runs out.
   *
   * Everything else here changes only when this window changes it, but a rite
   * has an hour on it and its cooldown ticks down whether anybody is looking.
   * Four seconds is enough for the refusal under the button to stop being a
   * lie without asking the island anything like as often as the clock does.
   */
  update(now: number): void {
    if (!this.win.isOpen || !this.island) return;
    if (now - this.lastAsk < REFRESH) return;
    this.lastAsk = now;
    void this.ask();
  }

  /** Ask the island, and draw what it said if it said anything new, or if `fresh` wants a redraw regardless. */
  private async ask(fresh = false): Promise<void> {
    if (!this.island) return;
    if (this.asking) {
      if (fresh) this.again = true;
      return;
    }
    this.asking = true;
    let changed = fresh;
    try {
      const [said, tree] = await Promise.all([this.island.classes(), this.island.tree()]);
      this.said = said;
      this.tree = tree;
      // The fold, fresh: the perks it holds are also this browser's to draw by.
      if (tree?.mul) this.game.setPerks((tree.mul as { fx?: Record<string, number> }).fx);
      const seen = JSON.stringify([said, tree]);
      if (seen !== this.seen) changed = true;
      this.seen = seen;
    } finally {
      this.asking = false;
    }
    if (changed) this.draw();
    if (this.again) {
      this.again = false;
      await this.ask(true);
    }
  }

  /** Do a thing at a door, say what it said, and ask again. */
  private async doorway(what: Promise<string | null>): Promise<void> {
    const why = await what;
    if (why) this.game.logMsg(why, 'error');
    else this.changed();
    await this.ask(true);
  }

  private show(tab: Tab): void {
    this.tab = tab;
    this.confirming = null;
    this.draw();
  }

  private draw(): void {
    for (const [id, b] of this.tabs) b.classList.toggle('tb-on', id === this.tab);
    // Redrawn on the clock, so it must not throw the reader back to the top.
    const top = this.page.scrollTop;
    this.page.replaceChildren();
    this.drawPage();
    this.page.scrollTop = top;
  }

  private drawPage(): void {
    if (!this.island) {
      if (this.tab === 'tree') {
        this.page.append(this.note('Playing by yourself in this browser there is no trade to hold, so there is no tree to spend. The Trades tab has what every trade offers.'));
        return;
      }
      this.page.append(this.note('Trades are the island’s to keep. Playing by yourself in this browser there is nobody holding the ledger, so none can be taken up, but what each one offers is here to read.'));
      this.drawBook();
      return;
    }
    if (!this.said) {
      this.page.append(this.note('Asking the island what you may take up…'));
      return;
    }
    if (this.said.why) {
      this.page.append(this.note(this.said.why));
      if (this.tab === 'trades') this.drawBook();
      return;
    }
    if (this.tab === 'trades') this.drawTrades(this.said);
    else this.drawTree();
  }

  private note(text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'trade-note';
    d.textContent = text;
    return d;
  }

  private group(title: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'trade-group';
    group.textContent = title;
    return group;
  }

  /* ---- the trades, and taking one up -------------------------------- */

  private drawTrades(said: ClassesSaid): void {
    const head = document.createElement('div');
    head.className = 'trade-head';
    const taken = [said.taken.craft, said.taken.combat].filter(Boolean).length;
    head.textContent = taken === 2
      ? `A trade of each. Putting one down for another costs ${said.change_cost} silver; you have ${Math.floor(said.purse)}.`
      : `A trade opens at ${said.at} in any skill it covers, and you may hold one craft and one fighting trade at once.`;
    this.page.append(head);

    for (const [kind, title] of GROUPS) {
      this.page.append(this.group(title));
      const mine = kind === 'craft' ? said.taken.craft : said.taken.combat;
      for (const c of said.classes.filter((x) => x.kind === kind)) {
        this.page.append(this.card(c, c.id === mine, said));
      }
    }
  }

  /** Every trade as the rulebook has it, with nothing to take: alone in the browser, or not on this island. */
  private drawBook(): void {
    for (const [kind, title] of GROUPS) {
      this.page.append(this.group(title));
      const book = CLASSES.filter((c) => c.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
      for (const c of book) this.page.append(this.card(this.read(c), false, null));
    }
  }

  /** A trade from the rulebook, standing where this browser's own skills put it. */
  private read(c: ClassDef): ClassCard {
    const at = (s: string): number => this.game.skills.get(s);
    return {
      id: c.id, kind: c.kind, name: c.name, note: c.note, main: c.main, lever: c.lever, skills: c.skills,
      points: classPoints(Math.max(...c.skills.map(at))), open: classOpen(c, at), why: null,
    };
  }

  /**
   * One trade's card. `said` is the island's answer, and without it the card
   * is only read: what the trade offers can be laid open, but nothing taken.
   */
  private card(c: ClassCard, mine: boolean, said: ClassesSaid | null): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `trade-card${mine ? ' trade-mine' : ''}${c.open || mine ? '' : ' trade-shut'}`;

    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = c.name;
    const pts = document.createElement('span');
    pts.className = 'trade-points';
    pts.textContent = this.standing(c, mine);
    top.append(name, pts);

    const note = document.createElement('div');
    note.className = 'trade-card-note';
    note.textContent = c.note;

    const covers = document.createElement('div');
    covers.className = 'trade-covers';
    covers.textContent = (c.skills ?? []).map((id) => skillName(id)).join(' · ');

    const lever = document.createElement('div');
    lever.className = 'trade-lever';
    lever.textContent = c.lever;

    const acts = document.createElement('div');
    acts.className = 'trade-acts';
    row.append(top, note, covers, lever, acts);

    if (mine) {
      const worn = document.createElement('span');
      worn.className = 'trade-worn';
      worn.textContent = 'Yours.';
      // Your own trade is drawn on the Tree tab, with what you have taken of it.
      const tree = button('Open the Tree tab', 'trade-take');
      tree.addEventListener('click', () => this.show('tree'));
      acts.append(worn, tree);
      /*
       * And the way back out of it, for somebody carrying a Bauble of Regret,
       * loose or in a bag: the island breaks the bauble and puts the trade
       * down as though it had never been taken up, so the next one taken up
       * in its place is free. One that is put by shows the button too, and
       * the island says why it will not break.
       */
      const carried = this.game.inventory.items.some((it) => it.id === REGRET || it.inside?.some((b) => b.id === REGRET));
      if (carried && said) {
        const undo = button('Undo, breaking the Bauble of Regret', 'trade-take');
        undo.title = `Puts the ${c.name.toLowerCase()}’s trade down and clears ${PERK_CLASSES.has(c.id) ? 'the perks taken for it' : 'its tree'}. The next trade you take up in its place costs nothing, not ${said.change_cost} silver.`;
        undo.addEventListener('click', () => void this.doorway(this.island!.regretClass(c.kind)));
        acts.append(undo);
      }
      return row;
    }

    const open = this.opened.has(c.id);
    const look = button(open ? 'Hide what it offers' : 'What it offers', 'trade-take');
    look.setAttribute('aria-expanded', String(open));
    look.addEventListener('click', () => {
      if (open) this.opened.delete(c.id);
      else this.opened.add(c.id);
      this.draw();
    });
    acts.append(look);

    // Only while the island would allow it: a refusal since then draws the refusal instead.
    const asking = this.confirming === `class:${c.id}` && !c.why;
    if (said && !asking) {
      const had = c.kind === 'craft' ? said.taken.craft : said.taken.combat;
      const take = button(had ? `Take up, for ${said.change_cost} silver` : 'Take up', 'trade-take');
      take.disabled = !!c.why;
      take.addEventListener('click', () => this.ask2(`class:${c.id}`));
      acts.append(take);
    }
    /*
     * The island's sentence, not ours. It knows the level you are at, what is
     * in your purse and how long ago you last changed your mind; repeating any
     * of that reasoning here would be a second place for it to be wrong.
     */
    if (said && c.why) row.append(this.why(c.why));
    if (said && asking) row.append(this.confirmClass(c, said));
    if (open) row.append(this.offer(c));
    return row;
  }

  /**
   * The figure at the top of a card: tiers open for a trade on perks, points
   * for a trade with a tree. A craft trade's tiers are counted from this
   * browser's copy of your skills, the same way the island opens them; a
   * fighting trade's from its own level, which is the island's to say and is
   * where every one starts until it is taken up.
   */
  private standing(c: ClassCard, mine: boolean): string {
    if (!PERK_CLASSES.has(c.id)) return mine ? `${c.points} points` : `would be ${c.points}`;
    const at = tiersAtFor(c.kind);
    const reach = c.kind === 'combat' ? this.classLevel(c.id, mine) : this.game.skills.get(c.main);
    const open = c.open || mine ? at.filter((x, i) => i === 0 || reach >= x).length : 0;
    if (mine && c.kind === 'combat') return `level ${Math.floor(reach)} · ${open} of ${at.length} tiers open`;
    return mine ? `${open} of ${at.length} tiers open` : `would open ${open} of ${at.length}`;
  }

  /** A fighting trade's level: the island's word for your own, and where it starts for one not yet taken up. */
  private classLevel(id: string, mine: boolean): number {
    return mine ? this.tree?.trades.find((t) => t.class === id)?.level ?? CLASS_LEVEL_START : CLASS_LEVEL_START;
  }

  /**
   * The first press: say what the second will do.
   *
   * The keyboard is left where it was rather than put on the second press. A
   * button with the keyboard on it is pressed by the space bar, and somebody
   * who has just clicked is as likely to press that next for something else.
   */
  private ask2(what: string): void {
    this.confirming = what;
    this.draw();
  }

  /** What taking up a trade will do, before it is done. */
  private confirmClass(c: ClassCard, said: ClassesSaid): HTMLDivElement {
    const had = c.kind === 'craft' ? said.taken.craft : said.taken.combat;
    const lines: string[] = [];
    if (had) {
      lines.push(`This puts the ${(classDef(had)?.name ?? had).toLowerCase()}’s trade down, and every `
        + `${PERK_CLASSES.has(had) ? 'perk you took' : 'node you bought'} for it goes with it. `
        + `It costs ${said.change_cost} silver; you have ${Math.floor(said.purse)}.`);
    } else {
      lines.push(`Putting it down later for another trade costs ${said.change_cost} silver, or a Bauble of Regret.`);
    }
    if (PERK_CLASSES.has(c.id)) {
      const first = perksOf(c.id).filter((p) => p.tier === 1).map((p) => p.name);
      lines.push(`Its first tier opens at once, and you take one of ${either(first)} on the Tree tab.`);
      if (c.kind === 'combat') {
        lines.push(`It starts at class level ${CLASS_LEVEL_START}, and its other tiers open at class levels `
          + `${listed(CLASS_TIER_AT.slice(1).map(String))}, as you land blows and kills while you hold it.`);
      }
    } else {
      lines.push(`You would have ${c.points} point${c.points === 1 ? '' : 's'} to spend in its tree now, and at most ${CLASS_POINTS_MAX}.`);
    }
    return this.confirm(`Take up the ${c.name.toLowerCase()}’s trade?`, lines, `Take up the ${c.name}`,
      () => this.island!.takeClass(c.id));
  }

  /**
   * The second press, and the way out of it. The first line is the question,
   * the rest is what answering it does.
   */
  private confirm(ask: string, lines: string[], yes: string, act: () => Promise<string | null>): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'trade-confirm';
    box.setAttribute('role', 'group');
    const q = document.createElement('div');
    q.className = 'trade-confirm-ask';
    q.textContent = ask;
    box.append(q);
    for (const line of lines) {
      const d = document.createElement('div');
      d.className = 'trade-confirm-line';
      d.textContent = line;
      box.append(d);
    }
    const acts = document.createElement('div');
    acts.className = 'trade-acts';
    const go = button(yes, 'trade-take trade-go');
    go.addEventListener('click', () => {
      go.disabled = true;
      this.confirming = null;
      void this.doorway(act());
    });
    const no = button('Not yet', 'trade-take');
    no.addEventListener('click', () => {
      this.confirming = null;
      this.draw();
    });
    acts.append(go, no);
    box.append(acts);
    box.setAttribute('aria-label', ask);
    return box;
  }

  /**
   * What a trade offers, laid open under its card: its six tiers of perks, or
   * its rite and its tree, as the rulebook has them. Nothing here can be
   * pressed; it is there to be read before the trade is taken up.
   */
  private offer(c: ClassCard): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'trade-offer';
    if (PERK_CLASSES.has(c.id)) {
      const combat = c.kind === 'combat';
      // A fighting trade's tiers open on its own level, which starts where everybody's does.
      const main = combat ? CLASS_LEVEL_START : this.game.skills.get(c.main);
      const perks = perksOf(c.id);
      tiersAtFor(c.kind).forEach((at, i) => {
        // The first opens with the trade, the rest in its main skill or its level.
        const reached = i === 0 ? c.open : main >= at;
        const tier = document.createElement('div');
        tier.className = `trade-tier${reached ? '' : ' trade-tier-shut'}`;
        const cap = document.createElement('div');
        cap.className = 'trade-card-top';
        const says = document.createElement('span');
        says.className = 'trade-col-head';
        says.textContent = i === 0 ? `Tier ${i + 1} · with the trade`
          : combat ? `Tier ${i + 1} · at class level ${at}` : `Tier ${i + 1} · at ${at} in ${skillName(c.main).toLowerCase()}`;
        cap.append(says);
        if (!reached && i > 0 && !combat) {
          const have = document.createElement('span');
          have.className = 'trade-points';
          have.textContent = `you have ${Math.floor(main)}`;
          cap.append(have);
        }
        const row = document.createElement('div');
        row.className = 'trade-grid';
        for (const p of perks.filter((x) => x.tier === i + 1)) row.append(this.shown(p.name, p.note));
        tier.append(cap, row);
        box.append(tier);
      });
      for (const r of RITES.filter((x) => x.class === c.id)) box.append(this.caption('Rite'), this.riteRead(r));
      return box;
    }

    for (const r of RITES.filter((x) => x.class === c.id)) box.append(this.caption('Rite'), this.riteRead(r));

    const nodes = CLASS_NODES.filter((n) => n.class === c.id);
    const whole = nodes.reduce((sum, n) => sum + n.cost, 0);
    box.append(this.caption('Tree'));
    const sums = document.createElement('div');
    sums.className = 'trade-covers';
    sums.textContent = `All ${numberWord(nodes.length)} nodes cost ${whole} points, and a trade earns at most ${CLASS_POINTS_MAX}. `
      + 'Each column is bought from the top down.';
    box.append(sums);
    const grid = document.createElement('div');
    grid.className = 'trade-grid';
    CLASS_COLUMNS[c.id].forEach((col, ci) => {
      const column = document.createElement('div');
      column.className = 'trade-col';
      const head = document.createElement('div');
      head.className = 'trade-col-head';
      head.textContent = CHANNELS[col.channel].name;
      head.title = CHANNELS[col.channel].note;
      column.append(head);
      for (const n of nodes.filter((x) => x.col === ci + 1).sort((a, b) => a.rank - b.rank)) {
        column.append(this.shown(n.name, n.note, `${n.cost} point${n.cost === 1 ? '' : 's'}`));
      }
      grid.append(column);
    });
    box.append(grid);
    return box;
  }

  /** A trade's rite as the rulebook has it, to be read and not called. */
  private riteRead(r: (typeof RITES)[number]): HTMLDivElement {
    const rite = document.createElement('div');
    rite.className = 'trade-rite';
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = r.name;
    const cost = document.createElement('span');
    cost.className = 'trade-points';
    cost.textContent = `${r.cost} favour · ${r.level} prayer`;
    top.append(name, cost);
    const note = document.createElement('div');
    note.className = 'trade-card-note';
    note.textContent = r.note;
    rite.append(top, note);
    return rite;
  }

  private caption(text: string): HTMLDivElement {
    const cap = document.createElement('div');
    cap.className = 'trade-col-head';
    cap.textContent = text;
    return cap;
  }

  /** A perk or a node as the rulebook has it: its name, what it does, and what it costs. */
  private shown(name: string, note: string, cost?: string): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'trade-node';
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const n = document.createElement('span');
    n.className = 'trade-node-name';
    n.textContent = name;
    top.append(n);
    if (cost) {
      const c = document.createElement('span');
      c.className = 'trade-points';
      c.textContent = cost;
      top.append(c);
    }
    const worth = document.createElement('div');
    worth.className = 'trade-worth';
    worth.textContent = note;
    box.append(top, worth);
    return box;
  }

  /* ---- the tree, the rite, and spending points ----------------------- */

  private drawTree(): void {
    const tree = this.tree;
    if (!tree) {
      this.page.append(this.note('Asking the island what you have bought…'));
      return;
    }
    if (!tree.trades.length) {
      this.page.append(this.note('No trade yet, so no tree. Take one up on the other tab.'));
      return;
    }
    const chans = new Map(tree.channels.map((ch) => [ch.id, ch]));
    for (const t of tree.trades) {
      if (t.tiers) {
        this.page.append(this.tierHead(t));
        // A fighting trade keeps its rite beside its tiers.
        for (const r of tree.rites.filter((x) => x.class === t.class)) this.page.append(this.rite(r));
        for (const tier of t.tiers) this.page.append(this.tier(tier, t));
        continue;
      }
      this.page.append(this.trade(t));
      for (const r of tree.rites.filter((x) => x.class === t.class)) this.page.append(this.rite(r));
      this.page.append(this.columns(t, chans));
    }
  }

  /* ---- a perk trade: six tiers, one of three at each ----------------- */

  private tierHead(t: TreeTrade): HTMLDivElement {
    const head = document.createElement('div');
    head.className = 'trade-tree-head';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = t.name;
    const tiers = t.tiers ?? [];
    const open = tiers.filter((x) => x.open && !x.perks.some((p) => p.taken)).length;
    const left = document.createElement('span');
    left.className = 'trade-points';
    left.textContent = (t.level != null ? `level ${Math.floor(t.level)} · ` : '')
      + (open ? `${open} to choose` : `${tiers.filter((x) => x.perks.some((p) => p.taken)).length} of ${tiers.length} chosen`);
    if (open) left.classList.add('trade-spare');
    head.append(name, left);
    return head;
  }

  /**
   * A tier: the skill it opens at and its three perks side by side. Once one
   * is taken the other two are drawn shut, since a tier gives one; before the
   * tier opens all three are shut, with the island's reason under each. The
   * second press for one of them goes under all three, since it is about all
   * three.
   */
  private tier(tier: TreeTier, t: TreeTrade): HTMLDivElement {
    const box = document.createElement('div');
    box.className = `trade-tier${tier.open ? '' : ' trade-tier-shut'}`;
    const cap = document.createElement('div');
    cap.className = 'trade-col-head';
    cap.textContent = tier.tier === 1 ? `Tier ${tier.tier} · with the trade`
      : t.kind === 'combat' ? `Tier ${tier.tier} · at class level ${tier.at}` : `Tier ${tier.tier} · at ${tier.at}`;
    const row = document.createElement('div');
    row.className = 'trade-grid';
    for (const p of tier.perks) row.append(this.perk(p));
    box.append(cap, row);
    const asked = tier.perks.find((p) => this.confirming === `perk:${p.id}` && !p.taken && !p.why);
    if (asked) box.append(this.confirmPerk(asked, tier, t));
    return box;
  }

  private perk(p: TreePerk): HTMLDivElement {
    const asked = this.confirming === `perk:${p.id}` && !p.taken && !p.why;
    const box = document.createElement('div');
    box.className = `trade-node${p.taken ? ' trade-node-taken' : ''}${!p.taken && p.why ? ' trade-node-shut' : ''}${asked ? ' trade-node-asked' : ''}`;
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-node-name';
    name.textContent = p.name;
    top.append(name);
    if (p.taken) {
      const mark = document.createElement('span');
      mark.className = 'trade-points';
      mark.textContent = 'taken';
      top.append(mark);
    }
    // The exact benefit, as the island has it from the same rulebook.
    const note = document.createElement('div');
    note.className = 'trade-worth';
    note.textContent = p.note;
    box.append(top, note);
    if (!p.taken && !asked) {
      const take = button('Take this one', 'trade-buy');
      take.disabled = !!p.why;
      take.addEventListener('click', () => this.ask2(`perk:${p.id}`));
      box.append(take);
    }
    if (!p.taken && p.why) box.append(this.why(p.why));
    return box;
  }

  /** What taking a perk will do: the other two close, and only putting the trade down opens them again. */
  private confirmPerk(p: TreePerk, tier: TreeTier, t: TreeTrade): HTMLDivElement {
    const others = tier.perks.filter((x) => x.id !== p.id).map((x) => x.name);
    const cost = this.said?.change_cost ?? CLASS_CHANGE_COST;
    return this.confirm(`Take ${p.name}?`, [
      p.note,
      `A tier gives one perk: ${listed(others)} ${others.length === 1 ? 'closes' : 'close'} for as long as you are ${article(t.name)} ${t.name.toLowerCase()}.`,
      `Choosing again means putting the whole trade down, and every perk taken for it: a Bauble of Regret does that, or taking up another trade for ${cost} silver.`,
    ], `Take ${p.name}`, () => this.island!.takePerk(p.id));
  }

  private trade(t: TreeTrade): HTMLDivElement {
    const head = document.createElement('div');
    head.className = 'trade-tree-head';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = t.name;
    const left = document.createElement('span');
    left.className = 'trade-points';
    const spare = t.points - t.spent;
    left.textContent = `${spare} of ${t.points} to spend`;
    if (spare > 0) left.classList.add('trade-spare');
    head.append(name, left);
    return head;
  }

  /**
   * The rite, at the head of its trade's tree.
   *
   * The button is drawn whatever the island says, and disabled with the reason
   * underneath, because "why can I not do this" is the question somebody has
   * when they open this window — a button that vanishes answers nothing.
   */
  private rite(r: RiteCard): HTMLDivElement {
    const box = document.createElement('div');
    box.className = `trade-rite${r.why ? '' : ' trade-rite-ready'}`;
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = r.name;
    const cost = document.createElement('span');
    cost.className = 'trade-points';
    cost.textContent = `${r.cost} favour · ${r.secs}s · then ${Math.round(r.rest / 60)}m`;
    top.append(name, cost);

    const note = document.createElement('div');
    note.className = 'trade-card-note';
    note.textContent = r.note;

    const call = button('Call it', 'trade-call');
    call.disabled = !!r.why;
    call.addEventListener('click', () => void this.doorway(this.island!.callRite(r.id)));

    box.append(top, note, call);
    if (r.why) box.append(this.why(r.why));
    return box;
  }

  /** Three columns of three, laid out the way the tree is shaped. */
  private columns(t: TreeTrade, chans: Map<string, ChannelCard>): HTMLDivElement {
    const grid = document.createElement('div');
    grid.className = 'trade-grid';
    for (const col of [1, 2, 3]) {
      const column = document.createElement('div');
      column.className = 'trade-col';
      const nodes = t.nodes.filter((n) => n.col === col).sort((a, b) => a.rank - b.rank);
      const ch = nodes.length ? chans.get(nodes[0].channel) : undefined;
      const cap = document.createElement('div');
      cap.className = 'trade-col-head';
      cap.textContent = ch ? ch.name : '';
      if (ch) cap.title = ch.note;
      column.append(cap);
      for (const n of nodes) column.append(this.node(n));
      grid.append(column);
    }
    return grid;
  }

  private node(n: TreeNode): HTMLDivElement {
    const box = document.createElement('div');
    box.className = `trade-node${n.taken ? ' trade-node-taken' : ''}${!n.taken && n.why ? ' trade-node-shut' : ''}`;
    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-node-name';
    name.textContent = n.name;
    const cost = document.createElement('span');
    cost.className = 'trade-points';
    cost.textContent = n.taken ? 'taken' : `${n.cost}`;
    top.append(name, cost);
    /*
     * The exact benefit, which is the whole of what a node has to say: the
     * number this channel multiplies and what this rank does to it. It arrives
     * that way from the island, so there is nothing here to work out and
     * nothing to say twice.
     */
    const note = document.createElement('div');
    note.className = 'trade-worth';
    note.textContent = n.note;
    box.append(top, note);


    if (!n.taken) {
      const buy = button(`Buy for ${n.cost}`, 'trade-buy');
      buy.disabled = !!n.why;
      buy.addEventListener('click', () => void this.doorway(this.island!.takeNode(n.id)));
      box.append(buy);
      if (n.why) box.append(this.why(n.why));
    }
    return box;
  }

  private why(text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = 'trade-why';
    d.textContent = text;
    return d;
  }
}

/** A small button of this window's, with whatever else it is for. */
function button(label: string, extra = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tb-btn tb-small${extra ? ` ${extra}` : ''}`;
  b.textContent = label;
  return b;
}

/** "a, b or c": one of them, not all. */
function either(xs: readonly string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
}

/** A skill's name as the skills window spells it, and its id if it has none. */
function skillName(id: string): string {
  return SKILL_DEFS.find((d) => d.id === id)?.name ?? id;
}
