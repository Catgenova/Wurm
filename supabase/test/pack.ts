/**
 * What a thing in your hands is, once it has crossed from the island.
 *
 * Reported as "players cannot drink from water skins or fill them". The island
 * fills a skin correctly — measurement 362 of the suite has said so since
 * skins were ported — and the browser's own rules for drinking from one are
 * correct too. The whole of the bug was the seam between them: `play.ts` read
 * six fields off a row and dropped the other seven, and a skin whose `charges`
 * never crossed reads empty for ever.
 *
 * So this measures the seam, which nothing did. The row goes in, the thing
 * comes out, and the browser's own `check` — the one that greys the Drink
 * entry out in the pack window — is asked about it, which is the question the
 * player was actually asking.
 */
import { ACTION_BY_ID, type ActionDef, type Target } from '../../src/game/actions';
import { itemName, RARITIES, type Item } from '../../src/game/items';
import { Island, type ItemRow } from '../../src/net/island';
import { packed, type Aged } from '../../src/net/packed';

let fails = 0;
let n = 0;
function say(what: string, got: unknown, want: unknown): void {
  n++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? '  ' : '!!'} ${n}. ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
}

/** A row as `select *` hands one over, with everything at its default. */
function row(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: 1, def: 'water_skin', ql: 50, dmg: 0, count: 1, extra: null, holder: 'player',
    charges: null, locked: false, issued: false, rare: null, dye: null, bless: null,
    lit: false, lit_at: null, ...over,
  };
}

/** An island whose clock says a fixed number of seconds have gone by. */
const after = (secs: number): Aged => ({ since: () => secs });
const still: Aged = after(0);

/**
 * The six-field map this replaces, kept so the measurement can show the bug
 * rather than only the fix. Delete it and two of the lines below stop meaning
 * anything.
 */
const asItWas = (it: ItemRow): Item => ({
  uid: it.id, id: it.def, ql: it.ql, dmg: it.dmg, count: it.count, extra: it.extra ?? undefined,
});

/** What the pack window would put on the entry: null to offer it, a reason to grey it out. */
function why(action: string, item: Item): string | null {
  const def = ACTION_BY_ID.get(action) as ActionDef;
  const target = { kind: 'item', uid: item.uid } as unknown as Target;
  // Standing at the shore with nothing else about: enough of a game for these
  // two, which ask what is in your hand and whether there is water near it.
  const game = {
    inventory: { get: (uid: number) => (uid === item.uid ? item : undefined) },
    nearWater: () => true,
    furnitureWithin: () => [],
  };
  return def.check?.(target, game as never) ?? null;
}

console.log('--- a water skin, which is what was reported');

const full = row({ charges: 5 });
say('the island says a full skin has', full.charges, 5);
say('and the six-field map made of that', asItWas(full).charges, undefined);
say('so Drink said', why('drink_skin', asItWas(full)), 'It is empty.');
say('the whole row makes of it', packed(full, still).charges, 5);
say('and Drink says', why('drink_skin', packed(full, still)), null);

const part = packed(row({ charges: 2 }), still);
say('two drinks left reads', part.charges, 2);
say('Drink allows it', why('drink_skin', part), null);

const empty = packed(row({ charges: 0 }), still);
say('an empty one reads', empty.charges, 0);
say('and Drink refuses it', why('drink_skin', empty), 'It is empty.');

/*
 * And the other half of the report. Filling was always *offered* — the browser
 * asked the island and the island did it — but the answer came back down the
 * same map, so the skin read empty again and Drink stayed grey. Which is the
 * same thing as not being able to fill it.
 */
console.log('\n--- and filling it');
say('a full skin refuses another fill', why('fill_skin', packed(row({ charges: 5 }), still)), 'It is already full.');
say('while the old map offered to fill a full one', why('fill_skin', asItWas(row({ charges: 5 }))), null);
say('and an empty one standing at the shore fills', why('fill_skin', packed(row({ charges: 0 }), still)), null);

/*
 * And what was written on the row all along.
 *
 * `itemName` has always put the charge in the name, so a live island did not
 * merely refuse to pour a drink — it said "Water skin (0/5)" in the pack
 * window after every fill, which is the report in the player's own words. The
 * dye and the rarity are in the same name for the same reason, and were as
 * silent.
 */
console.log('\n--- and what the pack window called it');
say('a full skin', itemName(packed(full, still)), 'Water skin (5/5)');
say('under the old map, after every fill', itemName(asItWas(full)), 'Water skin (0/5)');
say('two drinks gone', itemName(packed(row({ charges: 3 }), still)), 'Water skin (3/5)');
say('a blue supreme tunic',
  itemName(packed(row({ def: 'cloth_tunic', rare: 'supreme', dye: 'woad' }), still)),
  'Blue supreme cloth tunic');
say('which the old map called a', itemName(asItWas(row({ def: 'cloth_tunic', rare: 'supreme', dye: 'woad' }))),
  'Cloth tunic');

console.log('\n--- a lantern, which is charges that burn');

const dark = row({ id: 2, def: 'lantern', charges: 600, lit: false, lit_at: null });
say('an unlit lantern passes its charge straight through', packed(dark, after(999)).charges, 600);
say('and is not lit', packed(dark, still).lit, undefined);

const burning = row({ id: 2, def: 'lantern', charges: 600, lit: true, lit_at: '2026-01-01T00:00:00Z' });
say('a lantern lit is lit', packed(burning, still).lit, true);
say('ten minutes of candle, none of it burnt', packed(burning, after(0)).charges, 600);
say('ninety seconds in', packed(burning, after(90)).charges, 510);
say('and past the end it is nought, not less', packed(burning, after(4000)).charges, 0);
say('under the old map a lit lantern was dark', asItWas(burning).lit, undefined);

console.log('\n--- and the five that went with it');

say('a supreme thing', packed(row({ rare: 'supreme' }), still).rare, 2);
say('a rare one', packed(row({ rare: 'rare' }), still).rare, 1);
say('a fantastic one', packed(row({ rare: 'fantastic' }), still).rare, 3);
say('an ordinary one carries no rarity at all', packed(row(), still).rare, undefined);
say('and the words are the island\'s, not invented here',
  RARITIES.slice(1).map((r) => r.name), ['rare', 'supreme', 'fantastic']);

say('put by', packed(row({ locked: true }), still).locked, true);
say('not put by carries nothing', packed(row(), still).locked, undefined);
say('washed ashore with', packed(row({ issued: true }), still).issued, true);
say('dyed', packed(row({ dye: 'woad' }), still).dye, 'woad');
say('undyed', packed(row(), still).dye, undefined);
say('two circles of cunning', packed(row({ bless: 2 }), still).bless, 2);
say('none', packed(row(), still).bless, undefined);

say('and the six that always crossed still do',
  (({ uid, id, ql, dmg, count, extra }) => ({ uid, id, ql, dmg, count, extra }))(
    packed(row({ id: 7, def: 'oak_plank', ql: 31.5, dmg: 2, count: 4, extra: 'oak' }), still)),
  { uid: 7, id: 'oak_plank', ql: 31.5, dmg: 2, count: 4, extra: 'oak' });

/*
 * The clock the burn is taken off.
 *
 * `lit_at` is an instant and the browser needs an age, and this project has
 * been bitten once already by asking a phone what time it is. `since` works
 * between two of the island's own stamps and its own carried-forward reading,
 * so a machine whose clock is an hour out gets the same answer as one that is
 * right. Measured by moving this machine's idea of now and finding that it
 * does not matter.
 */
console.log('\n--- and none of it asks this machine what the hour is');

const isle = new Island({} as never);
isle.info = { id: 'x', name: 'x', seed: 1, size: 64, spawn_x: 0, spawn_y: 0, ready: true,
  epoch: '2026-01-01T00:00:00Z' };
(isle as unknown as { clock: { secs: number; at: number } }).clock =
  { secs: 300, at: performance.now() / 1000 };
say('lit a hundred seconds into the island\'s day, at second 300',
  Math.round(isle.since('2026-01-01T00:01:40Z')), 200);

const realNow = Date.now;
Date.now = () => realNow() + 3600_000;
say('and with this machine an hour fast, the same',
  Math.round(isle.since('2026-01-01T00:01:40Z')), 200);
Date.now = realNow;

say('a stamp it was never given is no age at all', isle.since(null), 0);

console.log(fails ? `\n${fails} of ${n} wrong` : `\nall ${n} right`);
process.exit(fails ? 1 : 0);
