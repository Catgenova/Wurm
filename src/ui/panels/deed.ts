import { DEED_RADIUS_PER_LEVEL, MAX_DEED_LEVEL, deedWorkersAt, rankAtLeast, type Deed, type Game } from '../../game/game';
import { DEED_ACTION_BY_ID, standingWord, upgradeProgress, upgradeReason } from '../../game/deed';
import { furnitureDef, furnitureName } from '../../game/furniture';
import { ageDef, STANCES, STANCE_NAMES } from '../../game/creatures';
import { ACTION_BY_ID } from '../../game/actions';
import { crateName } from '../../game/crates';
import { trapName } from '../../game/traps';
import { bridgeName } from '../../game/bridges';
import { postName } from '../../game/posts';
import type { UIWindow } from '../windows';

/**
 * The settlement at a glance.
 *
 * Everything about a deed used to be answered by clicking the token and
 * reading a menu: what level it is, how far the border runs, how many
 * wildermon are working, what the next upgrade wants, what is standing on the
 * land. This window is all of it on one page, and it walks you to anything on
 * it.
 */
export class DeedPanel {
  private body: HTMLDivElement;
  private lastRender = 0;

  constructor(
    private readonly win: UIWindow,
    private readonly game: Game,
    private readonly walkTo: (x: number, y: number) => void,
    /** Off the roll of a settlement you were asked onto; absent off an island. */
    private readonly leave?: (d: Deed) => void,
  ) {
    win.body.classList.add('deed-body');
    this.body = document.createElement('div');
    this.body.className = 'deed-list';
    win.body.append(this.body);
    game.events.on('world', () => this.render());
    game.events.on('inventory', () => this.render());
    this.render();
  }

  /** Workers and building go on while this is open; look again now and then. */
  update(now: number): void {
    if (!this.win.isOpen || now - this.lastRender < 900) return;
    this.lastRender = now;
    this.render();
  }

  private head(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'deed-head';
    el.textContent = text;
    return el;
  }

  /** One line: something said on the left, the figure on the right. */
  private row(label: string, value: string, title?: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'deed-row';
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    b.className = 'deed-value';
    b.textContent = value;
    if (title) el.title = title;
    el.append(a, b);
    return el;
  }

  /** A thing standing on the land, which one click walks you to. */
  private place(name: string, x: number, y: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'deed-row deed-place';
    const a = document.createElement('span');
    a.textContent = name;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn tb-small';
    const away = Math.round(Math.hypot(x + 0.5 - this.game.player.x, y + 0.5 - this.game.player.y));
    b.textContent = away ? `${away} away` : 'here';
    b.title = `Walk to (${x}, ${y})`;
    b.addEventListener('click', () => this.walkTo(x, y));
    el.append(a, b);
    return el;
  }

  render(): void {
    const g = this.game;
    const d = g.deed;
    this.body.replaceChildren();
    if (!d) {
      const none = document.createElement('div');
      none.className = 'deed-none';
      none.textContent = 'You have founded no settlement. Plant a settlement token on ground you want to call your own, and this window fills.';
      this.body.append(none);
      return;
    }
    const level = g.deedLevel;
    const workers = g.creatures.workers(g.time).length;
    const young = [...g.creatures.list.values()].filter((c) => c.mode === 'deed' && c.post === null && !ageDef(c, g.time).works).length;
    const crated = g.creatures.stored().length;
    const side = d.radius * 2 + 1;
    this.body.append(this.head(d.name));
    /*
     * One you were asked onto: whose it is, what you are on it, and the way
     * off it -- which used to be a line at the foot of the People window's
     * settlement page and nowhere else.
     */
    if (!rankAtLeast(d.role, 'founder')) {
      const holder = g.neighbourDeeds.find((n) => n.x === d.x && n.y === d.y)?.holder;
      if (holder) this.body.append(this.row('Founded by', holder));
      const standing = document.createElement('div');
      standing.className = 'deed-note';
      standing.textContent = standingWord(d.role);
      this.body.append(standing);
      if (this.leave) {
        const leave = this.leave;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tb-btn deed-leave';
        btn.textContent = `Leave ${d.name}`;
        btn.title = 'Takes you off its roll. You are asked first.';
        btn.addEventListener('click', () => leave(d));
        this.body.append(btn);
      }
    }
    this.body.append(this.row('Level', `${level} of ${MAX_DEED_LEVEL}`));
    this.body.append(this.row('Border', `${d.radius} tiles out · ${side} × ${side}`, `From the token at (${d.x}, ${d.y}).`));
    this.body.append(this.row('Working', `${workers} of ${g.workerCap}`, 'Grown wildermon set to work the deed. A young one takes no place until it is grown.'));
    this.body.append(this.row('Young of the herd', String(young), 'Not put to work, and taking no place, until grown.'));
    this.body.append(this.row('In creature crates', String(crated), 'Yours, shut in creature crates: neither working nor following you.'));
    this.body.append(this.row('Orders', STANCE_NAMES[g.deedStance()], 'What every wildermon on the deed does when something walks in.'));
    this.body.append(this.place('The token', d.x, d.y));

    // What the next level wants, and the button that buys it.
    this.body.append(this.head(level < MAX_DEED_LEVEL ? `Growing to level ${level + 1}` : 'Fully grown'));
    if (level < MAX_DEED_LEVEL) {
      const done = upgradeProgress(g);
      for (const r of done) {
        const el = this.row(`${r.met ? '✓' : '✗'} ${r.label}`, '');
        el.classList.add(r.met ? 'deed-met' : 'deed-unmet');
        this.body.append(el);
      }
      const why = upgradeReason(g);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tb-btn deed-upgrade';
      btn.textContent = `Upgrade · border ${d.radius + DEED_RADIUS_PER_LEVEL}, ${deedWorkersAt(level + 1)} workers`;
      btn.disabled = !!why;
      btn.title = why ?? 'Everything is in place. Take the settlement up a level.';
      btn.addEventListener('click', () => {
        const def = DEED_ACTION_BY_ID.get('upgrade_deed');
        if (def) g.requestAction(def, { kind: 'tile', x: d.x, y: d.y, cx: d.x, cy: d.y });
      });
      this.body.append(btn);
      if (why) {
        const note = document.createElement('div');
        note.className = 'deed-note';
        note.textContent = why;
        this.body.append(note);
      }
    }

    // Everything standing inside the border, so nothing has to be hunted for.
    const on = <T extends { x: number; y: number }>(m: Map<number, T>): T[] => [...m.values()].filter((v) => g.onOwnDeed(v.x, v.y));
    const buildings = [...g.buildings.list.values()].filter((b) => {
      const [bx, by] = (b.tiles[0] ?? '').split(',').map(Number);
      return Number.isFinite(bx) && g.onOwnDeed(bx, by);
    });
    const pieces = on(g.furniture);
    const altars = pieces.filter((f) => furnitureDef(f.kind).altar);
    this.body.append(this.head('What stands here'));
    const counts: Array<[string, number]> = [
      ['Buildings', buildings.length],
      ['Crates and bins', on(g.crates).length],
      ['Furniture', pieces.length],
      ['Campfires', on(g.campfires).length],
      ['Smelters', on(g.smelters).length],
      ['Kilns', on(g.kilns).length],
      ['Anvils', on(g.anvils).length],
      ['Altars', altars.length],
      ['Traps', on(g.traps).length],
      ['Work posts', on(g.posts).length],
    ];
    let any = false;
    for (const [label, n] of counts) {
      if (!n) continue;
      any = true;
      this.body.append(this.row(label, String(n)));
    }
    if (!any) {
      const bare = document.createElement('div');
      bare.className = 'deed-note';
      bare.textContent = 'Bare ground so far. Everything you build inside the border is counted here.';
      this.body.append(bare);
    }

    // The named things worth walking to.
    const marks: Array<{ name: string; x: number; y: number }> = [];
    for (const b of buildings) {
      const [bx, by] = (b.tiles[0] ?? '').split(',').map(Number);
      if (Number.isFinite(bx)) marks.push({ name: b.name, x: bx, y: by });
    }
    for (const f of pieces) marks.push({ name: furnitureName(f), x: f.x, y: f.y });
    for (const c of on(g.crates)) marks.push({ name: crateName(c), x: c.x, y: c.y });
    for (const t of on(g.traps)) marks.push({ name: trapName(t), x: t.x, y: t.y });
    for (const p of on(g.posts)) marks.push({ name: postName(p), x: p.x, y: p.y });
    for (const b of [...g.bridges.values()]) {
      const first = b.spans[0];
      if (first && g.onOwnDeed(first.x, first.y)) marks.push({ name: bridgeName(b), x: first.x, y: first.y });
    }
    if (marks.length) {
      this.body.append(this.head(`Walk to (${marks.length})`));
      marks.sort((a, b) => Math.hypot(a.x - g.player.x, a.y - g.player.y) - Math.hypot(b.x - g.player.x, b.y - g.player.y));
      for (const m of marks.slice(0, 40)) this.body.append(this.place(m.name, m.x, m.y));
    }

    // Standing orders, and the two things done to the deed itself: the
    // founder's, which the island refuses anybody else.
    if (!rankAtLeast(d.role, 'founder')) return;
    this.body.append(this.head('Orders for everything kept here'));
    const stance = g.deedStance();
    const row = document.createElement('div');
    row.className = 'deed-buttons';
    for (const st of STANCES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small' + (st === stance ? ' tb-on' : '');
      b.textContent = STANCE_NAMES[st];
      b.title = st === 'aggressive' ? 'Goes for anything wild that crosses the border' : st === 'defensive' ? 'Fights back when it or you are attacked' : 'Never fights, whatever walks in';
      b.addEventListener('click', () => {
        g.setDeedStance(st);
        this.render();
      });
      row.append(b);
    }
    this.body.append(row);
    const tail = document.createElement('div');
    tail.className = 'deed-buttons';
    for (const id of ['rename_deed', 'disband_deed']) {
      const def = ACTION_BY_ID.get(id);
      if (!def) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-btn tb-small' + (id === 'disband_deed' ? ' tb-danger' : '');
      b.textContent = def.label;
      b.addEventListener('click', () => g.requestAction(def, { kind: 'tile', x: d.x, y: d.y, cx: d.x, cy: d.y }));
      tail.append(b);
    }
    this.body.append(tail);
  }
}
