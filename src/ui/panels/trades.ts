import type { Game } from '../../game/game';
import type {
  ChannelCard, ClassCard, ClassesSaid, Island, RiteCard, TreeNode, TreeSaid, TreeTrade,
} from '../../net/island';
import { SKILL_DEFS } from '../../game/skills';
import type { UIWindow } from '../windows';

/**
 * The trades: which one is yours, the nine nodes behind it, and its rite.
 *
 * Every one of these doors has existed for a day with nothing drawing it.
 * `rpc_classes` says what may be taken, `rpc_tree` says what has been bought
 * and what it came to, and `rpc_take_class`, `rpc_take_node` and `rpc_rite`
 * are how a person spends any of it. This is the window.
 *
 * ## It works out nothing for itself
 *
 * Not one number here is the browser's. The rulebook in `src/game/classes.ts`
 * is what generated the island's rows, so the browser could in principle draw
 * the shape of a tree from memory -- but it has no idea which trade is yours,
 * how many points it has earned, what you have spent, what is in your purse or
 * whether the altar will hear you. All of that is the island's, and asking is
 * the whole design: the island is the authority, the browser asks and listens.
 *
 * So each door answers with what to draw *and* with its own refusal. A node
 * arrives carrying `why`, a rite arrives carrying `why`, and this window puts
 * that sentence under the button rather than guessing at the rule. There is
 * exactly one place that decides whether you may buy a node, and it is not
 * here.
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

export class TradesPanel {
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly page: HTMLDivElement;
  private tab: Tab = 'trades';

  private said: ClassesSaid | null = null;
  private tree: TreeSaid | null = null;
  /** One ask at a time, and not twice a frame. */
  private asking = false;
  private lastAsk = -1e9;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly island: Island | null,
  ) {
    win.body.classList.add('trade-body');
    const bar = document.createElement('div');
    bar.className = 'trade-tabs';
    for (const [id, label] of [['trades', 'Trades'], ['tree', 'Tree']] as Array<[Tab, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small';
      b.textContent = label;
      b.addEventListener('click', () => {
        this.tab = id;
        this.draw();
      });
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

  private async ask(): Promise<void> {
    if (!this.island || this.asking) return;
    this.asking = true;
    try {
      const [said, tree] = await Promise.all([this.island.classes(), this.island.tree()]);
      this.said = said;
      this.tree = tree;
    } finally {
      this.asking = false;
    }
    this.draw();
  }

  /** Do a thing at a door, say what it said, and ask again. */
  private async doorway(what: Promise<string | null>): Promise<void> {
    const why = await what;
    if (why) this.game.logMsg(why, 'error');
    await this.ask();
  }

  private draw(): void {
    for (const [id, b] of this.tabs) b.classList.toggle('tb-on', id === this.tab);
    this.page.replaceChildren();
    if (!this.island) {
      this.page.append(this.note('Trades are the island’s to keep. Playing by yourself in this browser, there is nobody holding the ledger.'));
      return;
    }
    if (!this.said) {
      this.page.append(this.note('Asking the island what you may take up…'));
      return;
    }
    if (this.said.why) {
      this.page.append(this.note(this.said.why));
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

  /* ---- the trades, and taking one up -------------------------------- */

  private drawTrades(said: ClassesSaid): void {
    const head = document.createElement('div');
    head.className = 'trade-head';
    const taken = [said.taken.craft, said.taken.combat].filter(Boolean).length;
    head.textContent = taken === 2
      ? `A trade of each. Putting one down for another costs ${said.change_cost} silver; you have ${Math.floor(said.purse)}.`
      : `A trade opens at ${said.at} in its main skill, and you may hold one craft and one fighting trade at once.`;
    this.page.append(head);

    for (const [kind, title] of [['craft', 'Crafting'], ['combat', 'Fighting']] as Array<['craft' | 'combat', string]>) {
      const group = document.createElement('div');
      group.className = 'trade-group';
      group.textContent = title;
      this.page.append(group);
      const mine = kind === 'craft' ? said.taken.craft : said.taken.combat;
      for (const c of said.classes.filter((x) => x.kind === kind)) {
        this.page.append(this.card(c, c.id === mine, said));
      }
    }
  }

  private card(c: ClassCard, mine: boolean, said: ClassesSaid): HTMLDivElement {
    const row = document.createElement('div');
    row.className = `trade-card${mine ? ' trade-mine' : ''}${c.open || mine ? '' : ' trade-shut'}`;

    const top = document.createElement('div');
    top.className = 'trade-card-top';
    const name = document.createElement('span');
    name.className = 'trade-name';
    name.textContent = c.name;
    const pts = document.createElement('span');
    pts.className = 'trade-points';
    pts.textContent = mine ? `${c.points} points` : `would be ${c.points}`;
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

    row.append(top, note, covers, lever);

    if (mine) {
      const worn = document.createElement('div');
      worn.className = 'trade-worn';
      worn.textContent = 'Yours.';
      row.append(worn);
      return row;
    }

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'tb-btn tb-small trade-take';
    const had = c.kind === 'craft' ? said.taken.craft : said.taken.combat;
    take.textContent = had ? `Take up, for ${said.change_cost} silver` : 'Take up';
    take.disabled = !!c.why;
    take.addEventListener('click', () => void this.doorway(this.island!.takeClass(c.id)));
    row.append(take);
    /*
     * The island's sentence, not ours. It knows the level you are at, what is
     * in your purse and how long ago you last changed your mind; repeating any
     * of that reasoning here would be a second place for it to be wrong.
     */
    if (c.why) row.append(this.why(c.why));
    return row;
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
      this.page.append(this.trade(t));
      for (const r of tree.rites.filter((x) => x.class === t.class)) this.page.append(this.rite(r));
      this.page.append(this.columns(t, chans));
    }
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

    const call = document.createElement('button');
    call.type = 'button';
    call.className = 'tb-btn tb-small trade-call';
    call.textContent = 'Call it';
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
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'tb-btn tb-small trade-buy';
      buy.textContent = `Buy for ${n.cost}`;
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

/** A skill's name as the skills window spells it, and its id if it has none. */
function skillName(id: string): string {
  return SKILL_DEFS.find((d) => d.id === id)?.name ?? id;
}
