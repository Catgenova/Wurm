/**
 * What every key does, and how to say it should do something else.
 *
 * Until now the keys lived in one `switch` in `main.ts`, which was fine while
 * nobody wanted to change them and useless the moment somebody did. This is the
 * same list said once, as data: an id, what it is for, and the codes that reach
 * it. `main.ts` asks "what is this key for" instead of knowing, and the Settings
 * window writes to the same table it reads.
 *
 * Two things are deliberately not in here. The **number keys** are not a
 * binding, they are ten of a kind: 1–9 and 0 answer to whatever the selection
 * window or the toolbelt is offering, and a rebindable "action 7" would be a
 * different game. And **the mouse** is not in here either, because there is
 * nothing to choose: left click walks and right click asks, and a game with
 * only two buttons has no room for a preference.
 *
 * Codes are `KeyboardEvent.code` — physical keys, not letters — so a binding
 * made on one layout still lands under the same finger on another.
 */

/** What a key can be set to do. */
export interface BindDef {
  id: string;
  label: string;
  hint: string;
  group: string;
  /** Codes it answers to, best first. Two is the most any of them keeps. */
  keys: string[];
}

export const BIND_GROUPS = ['Moving the view', 'Windows', 'Doing things'] as const;

/**
 * The defaults.
 *
 * WASD pushes the **view** rather than the body: walking is a click, and a
 * click is the only thing that walks. The arrows do the same as WASD so that a
 * hand on either side of the keyboard can shift the view.
 */
export const BINDS: BindDef[] = [
  { id: 'pan_up', label: 'Push the view up', hint: 'Slides the view away from you; the camera stops following while it does.', group: 'Moving the view', keys: ['KeyW', 'ArrowUp'] },
  { id: 'pan_down', label: 'Push the view down', hint: 'As above, the other way.', group: 'Moving the view', keys: ['KeyS', 'ArrowDown'] },
  { id: 'pan_left', label: 'Push the view left', hint: 'As above.', group: 'Moving the view', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'pan_right', label: 'Push the view right', hint: 'As above.', group: 'Moving the view', keys: ['KeyD', 'ArrowRight'] },
  { id: 'centre', label: 'Centre on yourself', hint: 'Bring the view back to your own feet and have it follow again.', group: 'Moving the view', keys: ['KeyC'] },
  { id: 'turn_left', label: 'Turn the view left', hint: 'A quarter turn. The compass shows where north went. While something is being set down, it turns that instead.', group: 'Moving the view', keys: ['KeyQ'] },
  { id: 'turn_right', label: 'Turn the view right', hint: 'A quarter turn the other way, of the view or of what is being set down.', group: 'Moving the view', keys: ['KeyE'] },
  { id: 'zoom_in', label: 'Zoom in', hint: 'The same as scrolling up, for a hand that is not on the mouse.', group: 'Moving the view', keys: ['Equal', 'NumpadAdd'] },
  { id: 'zoom_out', label: 'Zoom out', hint: 'The same as scrolling down.', group: 'Moving the view', keys: ['Minus', 'NumpadSubtract'] },
  { id: 'storey_up', label: 'Look at the storey above', hint: 'Inside a building with more than one floor.', group: 'Moving the view', keys: ['PageUp'] },
  { id: 'storey_down', label: 'Look at the storey below', hint: 'As above, downwards.', group: 'Moving the view', keys: ['PageDown'] },
  { id: 'cutaway', label: 'Cut away the walls facing you', hint: 'Take away the walls between you and the inside of a building.', group: 'Moving the view', keys: ['KeyX'] },
  { id: 'grid', label: 'Show the tile grid', hint: 'Outline every tile.', group: 'Moving the view', keys: ['KeyG'] },

  { id: 'win_inventory', label: 'Inventory', hint: 'Everything you are carrying.', group: 'Windows', keys: ['KeyI'] },
  { id: 'win_craft', label: 'Crafting', hint: 'Everything you could make with what you have.', group: 'Windows', keys: ['KeyR'] },
  { id: 'win_tile', label: 'Tile', hint: 'Everything you could do to whatever you last clicked.', group: 'Windows', keys: ['KeyT'] },
  { id: 'win_skills', label: 'Skills', hint: 'What you know and how well.', group: 'Windows', keys: ['KeyK'] },
  { id: 'win_tracker', label: 'Tracker', hint: 'The few trades you are watching today, with a bar apiece.', group: 'Windows', keys: ['KeyV'] },
  { id: 'win_events', label: 'Event log', hint: 'What has been happening, and the box you talk in.', group: 'Windows', keys: ['KeyL'] },
  { id: 'win_map', label: 'Map', hint: 'The island as far as you have seen it.', group: 'Windows', keys: ['KeyM'] },
  { id: 'win_wildermon', label: 'Wildermon', hint: 'Your tamed creatures, what they carry and what they are set to.', group: 'Windows', keys: ['KeyP'] },
  { id: 'win_deed', label: 'Settlement', hint: 'Your deed at a glance.', group: 'Windows', keys: ['KeyN'] },
  { id: 'win_social', label: 'Social', hint: 'Who is waiting on you, who you know and where they are, and what has been written to you.', group: 'Windows', keys: ['KeyY'] },
  { id: 'win_ledger', label: 'Ledger', hint: 'Everything you have ever made.', group: 'Windows', keys: ['KeyB'] },
  { id: 'win_stores', label: 'Stores', hint: 'What is in every crate and cupboard on your deed, in one list.', group: 'Windows', keys: ['KeyU'] },
  { id: 'win_journal', label: 'Journal', hint: 'Everything worth doing, ticking itself off.', group: 'Windows', keys: ['KeyJ'] },
  { id: 'win_settings', label: 'Settings', hint: 'This window.', group: 'Windows', keys: ['KeyO'] },
  { id: 'win_help', label: 'Help', hint: 'How any of this works.', group: 'Windows', keys: ['F1', 'KeyH'] },

  { id: 'walk_home', label: 'Walk home', hint: 'Set off for your settlement token, or your bed.', group: 'Doing things', keys: ['Home'] },
  /*
   * One key for all of them rather than one each. Two emotes is a pair of
   * keybindings; five is a keyboard nobody can remember, and the menu costs
   * one keypress more than a bind and never runs out of room.
   */
  { id: 'emotes', label: 'Emotes', hint: 'Wave, hop, and whatever else there is to do with your hands.', group: 'Doing things', keys: ['KeyZ'] },
  { id: 'stop', label: 'Stop', hint: 'Drop the current job and forget what is queued behind it. Closes an open menu first.', group: 'Doing things', keys: ['Escape'] },
  { id: 'chat', label: 'Talk', hint: 'Put the cursor in the box at the bottom of the event log.', group: 'Doing things', keys: ['Enter'] },
];

export const BIND_BY_ID = new Map(BINDS.map((b) => [b.id, b]));
/** The most keys any one thing answers to. */
export const MAX_KEYS = 2;

const STORAGE_KEY = 'wurm-iso-keys';

/**
 * How a key code reads on a key.
 *
 * `KeyboardEvent.code` is a physical position with a name like `Semicolon`,
 * which is exactly wrong to put in front of somebody. These are the ones worth
 * spelling out; anything else has its prefix taken off and is left alone.
 */
const NAMES: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Equal: '=', Minus: '−', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
  Comma: ',', Period: '.', Slash: '/',
  Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab',
  PageUp: 'Page Up', PageDown: 'Page Down', Home: 'Home', End: 'End',
  Insert: 'Insert', Delete: 'Delete', Backspace: 'Backspace',
  CapsLock: 'Caps Lock', ContextMenu: 'Menu',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×',
  NumpadDivide: 'Num ÷', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter',
};

export function keyName(code: string): string {
  if (NAMES[code]) return NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/**
 * Keys that are spoken for whatever anybody would rather they did.
 *
 * The digits are the selection window and the toolbelt, and taking one of them
 * for something else would leave a hole in a row of ten. The modifiers are not
 * keys anybody presses on their own.
 */
export function keyReserved(code: string): string | null {
  if (/^Digit[0-9]$/.test(code)) return 'The number keys belong to the selection window and the toolbelt.';
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) return 'That is a modifier, not a key.';
  return null;
}

interface Saved {
  [id: string]: string[];
}

/**
 * The live table: what each thing answers to, and what each key reaches.
 *
 * Kept in `localStorage` rather than in the save, for the same reason the
 * window layout is: it is a fact about the person sitting here, not about the
 * island. Carrying it in a save would mean a keyboard changing under you when
 * you loaded somebody else's world.
 */
export class Keybinds {
  private keys = new Map<string, string[]>();
  private byCode = new Map<string, string>();
  /** Told whenever anything is rebound, so the help and the panel can redraw. */
  onChange?: () => void;

  constructor() {
    this.reset(false);
    this.load();
  }

  /** The codes one thing answers to, in the order they are shown. */
  codes(id: string): string[] {
    return this.keys.get(id) ?? [];
  }

  /** What this key does, or null. */
  actionFor(code: string): string | null {
    return this.byCode.get(code) ?? null;
  }

  /** Whether a key that is being held is one of the ones bound to this. */
  isHeld(id: string, down: (code: string) => boolean): boolean {
    for (const code of this.codes(id)) if (down(code)) return true;
    return false;
  }

  /** How the binding reads, for a table or a tooltip. */
  label(id: string): string {
    const codes = this.codes(id);
    return codes.length ? codes.map(keyName).join(' / ') : 'unbound';
  }

  /**
   * Put a code in one of a thing's slots.
   *
   * A key does one thing. Binding a key that is already spoken for takes it off
   * whatever had it, rather than leaving two things fighting over one press and
   * letting the order of a list decide which wins. What comes back says what
   * was displaced, so the panel can say so out loud.
   */
  bind(id: string, slot: number, code: string): { ok: boolean; why?: string; took?: string } {
    if (!BIND_BY_ID.has(id)) return { ok: false, why: 'There is no such thing to bind.' };
    const reserved = keyReserved(code);
    if (reserved) return { ok: false, why: reserved };
    const had = this.byCode.get(code);
    if (had === id && this.codes(id)[slot] === code) return { ok: true };
    if (had) this.setCodes(had, this.codes(had).filter((c) => c !== code));
    const mine = this.codes(id).slice();
    mine[slot] = code;
    this.setCodes(id, mine);
    this.save();
    this.onChange?.();
    return { ok: true, took: had && had !== id ? had : undefined };
  }

  /** Take a key off something, leaving the slot empty. */
  clear(id: string, slot: number): void {
    const mine = this.codes(id).slice();
    if (mine[slot] === undefined) return;
    mine.splice(slot, 1);
    this.setCodes(id, mine);
    this.save();
    this.onChange?.();
  }

  /** Back to how it came out of the box. */
  reset(tell = true): void {
    this.keys.clear();
    for (const b of BINDS) this.keys.set(b.id, b.keys.slice());
    this.reindex();
    if (tell) {
      this.save();
      this.onChange?.();
    }
  }

  /** Whether anything at all has been changed from the defaults. */
  get changed(): boolean {
    for (const b of BINDS) {
      const mine = this.codes(b.id);
      if (mine.length !== b.keys.length) return true;
      for (let i = 0; i < mine.length; i++) if (mine[i] !== b.keys[i]) return true;
    }
    return false;
  }

  private setCodes(id: string, codes: string[]): void {
    this.keys.set(id, codes.filter((c) => !!c).slice(0, MAX_KEYS));
    this.reindex();
  }

  private reindex(): void {
    this.byCode.clear();
    for (const [id, codes] of this.keys) for (const c of codes) this.byCode.set(c, id);
  }

  private save(): void {
    try {
      const out: Saved = {};
      for (const b of BINDS) out[b.id] = this.codes(b.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // A browser with storage switched off still plays; it just forgets.
    }
  }

  /**
   * What was saved, over the defaults.
   *
   * Read one binding at a time rather than wholesale: a saved table written
   * before a new thing was added has no row for it, and the default should
   * stand rather than the new thing arriving unbound.
   */
  private load(): void {
    let saved: Saved | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw) as Saved;
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;
    for (const b of BINDS) {
      const codes = saved[b.id];
      if (!Array.isArray(codes)) continue;
      this.keys.set(b.id, codes.filter((c) => typeof c === 'string' && !keyReserved(c)).slice(0, MAX_KEYS));
    }
    this.reindex();
  }
}
