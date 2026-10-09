# Spells: casting animations and effects — notes for the effects artists

Read BRIEF.md (beside this file in the animation scratchpad, `anim/`) first for the figure, the worktree rules,
typecheck, commit/no-push and code style. This is the spell framework those rules apply to. Code: `src/render/spells/`
(doc comment at the top of `index.ts` is the short form of this file; this file is kept there too, as
`src/render/spells/SPELLS.md`).

## Your file, and only your file

One file per group. You own yours and nobody else touches it; you touch nothing else.

| file | spells |
|---|---|
| `blade.ts` `berserker.ts` `pikeman.ts` `archer.ts` `skirmisher.ts` `chirurgeon.ts` `beastmaster.ts` | the trade's 12 class spells |
| `kindler.ts` | 12 class spells + arcane `ember`, `pyre` |
| `binder.ts` | 12 class spells + arcane `snare`, `stillfield` |
| `warder.ts` | 12 class spells + arcane `aegis`, `bulwark` |
| `blessing.ts` `justice.ts` `chaos.ts` | the patron's 15 faith spells |

Each file exports `PALETTE` and a record `{ [spellId]: SpellVisual }`. Every entry starts as
`placeholder('<id>', PALETTE)` with a comment naming the spell, how it is cast, what it is cast on, its radius and
how long it lasts, and the first sentence of its note. Replace entries one by one. Helpers shared by your spells
(a slash of your own, a sigil, a shared impact) go in your file, above the record.

Do NOT edit `index.ts`, `kit.ts`, `stage.ts`, `generic.ts`, `poses.ts`, `info.ts`, `preview.ts`, `figure.ts` or
the renderer. If you need something the kit lacks, write it in your own file on top of `k.worldDraw`,
`k.groundDraw`, `k.glowDraw` (the raw recorders) and say in your report what you would have wanted in the kit.
Everything added to the framework is opt-in: a file that uses none of it compiles and looks as it did.

## A visual

```ts
import { placeholder } from './generic';
import type { SpellVisual } from './index';
import { arcAt, flashOf, seg, smooth, type SpellPalette } from './kit';
import { euler, one, beats, bolt as boltPose, withPose } from './poses';

kindler_scorch: {
  palette: PALETTE,
  cast: {
    timing: { secs: 1.0, release: 0.55 },           // seconds; release = when it leaves the hand (0..1)
    pose: (r, t, c) => { ... },                      // write the Rig at t (0..1 through the cast)
    face: 'target',                                  // optional: 'target' (default) | 'companion' | 'none'
    hold: { at: 0.6, secs: 8 },                      // optional: stop the pose at 0.6 for 8 s (default: the linger)
    move: { from: 0, to: 0.45 },                     // optional: when a move the island made is travelled
  },
  fx: {
    charge: (k, t) => { ... },                       // every frame while cast, t 0..1 of the cast
    release: (k) => { ... },                         // once, at release
    travel: { secs: (tiles) => 0.1 + tiles * 0.06, draw: (k, u) => { ... } },  // release -> landing, u 0..1
    hit: (k) => { ... },                             // once, on landing (at release if no travel)
    impact: { secs: 0.7, draw: (k, u) => { ... } },  // from landing, u 0..1
    linger: { on: 'target', draw: (k, age, left) => { ... } },  // from landing for the spell's own duration
  },
},
```

Every part is optional. A cast ends when its pose, impact and linger are all over. Keep the placeholder's parts
you like: `{ ...placeholder(id, PALETTE), fx: { ...placeholder(id, PALETTE).fx, hit: myHit } }`.

### How long things last

`linger` runs for `SpellInfo.lasts`, derived from the game's own numbers (never typed twice): `fx.secs`; a hold's
seconds (`fx.hold`, a Binder's hold as a share of a Snare at binding 50); a skin (Warder, Aegis, Bulwark) shows for
`SKIN_SHOWN` = 12 s because the island does not say when it is used up. Give `linger: { secs: n, draw }` to override.
Where the island says how long what the cast left on its target lasts (`k.told`, below), a linger on the target lasts
that instead: a Skull Crack's mark 1 s on a monster and 2 s on an animal, a Scorch's burn as long as a Firebrand made it.
A waiting spell the island says a later cast spent (a Stoke, a Thicken) has its linger let go `USED_FADE` (0.4 s) after.
Lingers on a creature end when the creature dies or leaves sight; `linger.on` says what a linger is on, and so what
ends it early: `'target'` (the default), `'caster'` (a stance or a skin of one's own after a strike: it plays on when the
creature struck dies, and ends only if the caster goes) or `'spot'` (an area on the ground: only its seconds end it).
Read the spell's numbers in fx as `k.fx.reach`,
`k.fx.secs`, `k.fx.wide`, … and its area as `spellInfo(id).radius` — derive sizes from them (a Firestorm's ring
should reach `k.fx.reach` tiles because that is what it hits).

Some lingers are long (Second Life 600 s, Due Reward 1800 s, Steady Hands 1800 s): keep those subtle — a faint
mark, a few motes — not a light show for half an hour.

## The pose

`pose(r, t, c)` writes the figure's `Rig` (render/figure.ts), degrees:

- `arm[k]` = [forward, out from the side, turned in]; k = 1 right, 0 left. 180 forward = straight up.
- `elbow[k]` bend; `hand[k]` = [pitch, roll, yaw]; `open[k]` open hand.
- `spine`, `chest`, `neck`, `head` = [pitch, roll, yaw]; **positive pitch leans back**, positive yaw turns the
  front to the body's left. `leg[k]` = [forward, out, turned], `knee[k]` bend.
- `wield` (0..1): the weapon in the right fist follows the forearm (blade along the forearm's forward-down line)
  instead of the hip carry, so a swing swings it. Placeholders set `wield = 1` for strikes and thrusts.
  Spears, bows, two hands on a haft, hand shapes, an open mouth and kneeling have fields of their own: see
  "Weapons, hands, face, kneeling" below.
- `c.timing`, `c.facing` (0..7), `c.moving`, `c.carry` ('fist' | 'staff' | 'bow' | 'shoulder' | null).
- `c.at`: what it was cast at, `'self' | 'person' | 'creature' | 'spot'` — a self-heal can keep its hands in where a
  heal on somebody else reaches out (`onSelf(c)` in poses.ts). Always set by the stage; typed optional only so a cue
  you build yourself (`{ ...c, timing }`) still compiles.
- `c.held`: how far through a held pose (below) it is, 0..1 (`heldFor(c)`); 0 with no hold.
- `c.aim`: where the target stands from the caster, in the body's frame and **height units** (a tile is 40, a person
  ~18 tall), measured from where the caster stands: `ahead` (to its middle, along the way the body faces), `aside`
  (to the right of that line), `near` (ahead to its near side: `ahead` less its half-width), `head`, `chest`, `top`
  (how high its head, its chest and its top are over the caster's feet — a wolf's head is knee-high, an ogre's well
  over yours), and `close` (how far the stage carries the body in for the blow, `cast.close` below; 0 without).
  Undefined for a cast on oneself. A spot on the ground gives the ground's height for all three heights.
- `c.moved`: tiles the island moved the caster for this cast (a Lunge's stride); 0 when it did not — a Lunge already
  in reach has nothing to run, so play the thrust without the run.
- `c.companion`: `{ ahead, aside }` (height units) to the caster's companion, for a pose that reaches to it or turns
  to it (Lick Wounds stroking the beast, not the air); undefined with none.
- `c.lefty`: the cast is being played left-handed (`cast.mirror`, below); `c.facing` is then the mirrored facing.
- `c.look`: the caster's look, for `stepIn` / `reachHand` to solve for the caster's own build.

Write it at full strength through the whole cast; the framework blends in over the first `blendIn` (0.12) and out
over the last `blendOut` (0.25) of the cast (set `blend: false` to own the whole curve). While the caster walks,
swims or drives, only arms and trunk are kept (legs, hips, height stay the walk's). The body is turned to face the
target when the cast starts, so "ahead" (+y, arm forward) is at the target; `cast.face: 'companion'` turns it to the
companion instead (a command spell), `'none'` leaves it as it was.

**Holding a pose.** `cast.hold: { at, secs? }` stops the pose's own clock at `at` (0..1) for `secs` seconds (the
spell's linger when not given), then plays the rest. Everything keyed to the cast waits with it: `charge` keeps being
called (its `t` stays at `at` through the hold), a release after `at` comes after the hold, the blend-out comes at the
end. Walking off ends the hold at once. A stance that breathes uses `c.held`.

**A move the island made.** For a Lunge or a Parting Throw the island has already put the body where it ends up when
the cast is drawn. The cast event now carries where the caster stood (`from`), and the stage carries the body from
there to where it is over `cast.move` (`from`..`to` of the way through the pose; 0 to the release by default) —
without a `move` such a cast still travels over that much, so the body never jumps. `k.from` is that start point on
the ground (null for a cast made standing), and `k.caster` is wherever the body has got to this frame.

**A shouldered weapon, swung from the hand it is in: `cast.mirror: true`.** The figure carries a maul or a battle
axe over the *left* shoulder at facings 3, 6 and 7 (over the right it would be behind the head), and over the right
at the rest. A blow written right-handed then needs the weapon in the other hand, and setting `r.carried = 1` moved
it there in one frame (15–19 units) at the start and the end of the cast. With `mirror: true`, a cast made while the
weapon is on the left shoulder is **played left-handed**: write the pose right-handed as always; the framework
mirrors the pose under it, lays yours over that, and mirrors the two back — joints, hands' shapes, `reach` goals
(swapped, x negated), the kneeling knee, and the hand the weapon is in. Nothing changes hands, ever, and the swing is
on the side the figure keeps in view. `c.lefty` tells the pose, `k.lefty` / `k.side` (−1 / 1) tell the effects:
multiply anything put to one side by `k.side` (`k.local(b, k.side * 4, …)`, a slash's `tilt`) and ask for
`k.hand(k.lefty ? 0 : 1)` — or draw cuts with `k.trail`, which follows the real weapon either way. Only shouldered
weapons are mirrored (a sword or a spear is always in the right fist). While a cast is on, the figure no longer
starts carrying the weapon over to the other shoulder (it did, when the cast turned the body: the weapon floated on
the swap's way through the blow and changed hands half way); it goes over once the cast is done. Proved by a
per-frame probe over every cast × battle axe and maul × facings 0–7: with `mirror` no first or last frame moves any
bone or the weapon's head more than 0.67 units (berserker was 15–16 at facings 3, 6, 7).

**Melee distance, and closing in: `cast.close`.** The island lets a blow be struck from as far as the weapon reaches
(`melee_reach`: 2.2 tiles for a sword, an axe or bare hands; a spear 3.2) and a creature comes to 1.1 tiles to strike
(`HUNT_REACH`); a Lunge lands 0.4 inside the reach (1.8). A tile is 40 units and a standing blow reaches about 6
units plus the weapon (17 for an axe), so no blow can be seen to land standing. `cast.close: true` (or a
`CastClose` `{ from, to, back, reach, most, after, steps, when }`) has the stage carry the drawn body toward the
target over the wind-up (`from`..`to`, 0 to the release) by exactly what the blow is short of its near side (`reach` =
6 + the weapon's length, at most `most` = 2 tiles), and back from `back` (the follow-through) to `after` seconds past
the end of the cast (0.4–0.6 by distance), the legs running in and bounding back (see "New API", below). The island
has not moved the body; it is drawn there and put back. `k.caster` is where it is drawn, so every effect follows; the
renderer draws it there (`shiftOf`). Not while it walks. `c.aim.close` says how far it will be carried.

**Stepping in: `stepIn(r, t, c, { hit, from?, back?, by?, reach?, most?, lead? })`** (poses.ts), called last in a
pose: the body carried `by` units ahead over `from`..`hit` (the lead foot — the left — lifted and put down further on;
past the first 3 units the back foot follows it in a beat behind, so a long step no longer splits the legs; both legs
solved to their feet, the hips let down), and back over `back`..1.
`by` defaults to what is missing: `c.aim.near - c.aim.close - reach` (reach 16), at most `most` (12 units). With
`cast.close` the stage does the long way and `stepIn` the last stride. Returns how far the body is carried now.

**Arms flung wide: `armOut(k, forward, out)`** (poses.ts) — the arm raised `forward` degrees from hanging (90 level
ahead, 180 straight up) and opened `out` degrees away from the body, **always away**, at any height:
`r.arm[0] = armOut(0, 140, 60); r.arm[1] = armOut(1, 140, 60)` is a V flung up and wide. Use it (or `armToward`)
instead of `[140, 60, -10]`, which crosses the arms over the head (the flip below, kept for the poses written with it).

**The target moved by the spell: `cast.pull: true`** (or `{ from, to }`). For a Hook the island drags the creature in
before the cast is drawn. The cast event now carries where it stood (your own casts: `targetFrom`), and the stage
draws it — the creature itself, and `k.target` — carried from there to where the island put it over `from`..`to`
(0 to the release), so it is hooked and comes, rather than being there already.

**The companion moved by the spell: `cast.companion: true`** (or `{ from, to, beside }`): a Pounce's leap is drawn
from where the beast stood to where the island put it; a Guard Me that puts it on your own spot draws it a step off
to your left instead of inside you (`beside`, the default).

`poses.ts` gives keyframes: `euler(t, [[t0, [a,b,c]], [t1, [...]], ...])`, `one(t, [[t0, v], ...])`, `track`,
and `beats(c)` → `{ top, let, through, back }` fractions keyed to `release`. The stand-ins (`strike`, `thrust`,
`shot`, `throw`, `bolt`, `curse`, `buff`, `ally`, `nova`, `ground`, `command`, `pray`) are worked examples;
`withPose(strike, (r, t, c) => { ... })` starts from one and changes what differs; `stepIn` and `armOut` above.

### Weapons, hands, face, kneeling: the opt-in Rig fields

All optional; a pose that sets none of them is drawn exactly as before. Numbers are shares (0..1) or degrees and
blend in from nought with the cast; switches (`nocked`, `thrown`, `kneelLeft`) go over at once. Without them a bow
(`carry 'bow'`) and a spear (`'staff'`) stand off the hips whatever the arms do, and only a fist-carried weapon
follows the arm with `wield`. A shouldered weapon (`'shoulder'`: maul, battle axe) is always in the fist of hand
`r.carried`, which the carry sets to 0 (the left) seen from facings 3, 6 and 7 — set `r.carried = 1` in your pose to
keep it in the right.

| field | what it does | how a pose uses it |
|---|---|---|
| `wieldStaff` | a spear/javelin taken by the arms: along the right forearm, point past the knuckles; with `both`, along the line from the right fist **through the left** | `r.wieldStaff = 1; r.both = 1;` then put the two fists on the line you want (arm angles, or `reach`): a thrust levels it, hands low and the right behind grounds the butt (a brace), `haft` spins it (a whirl) |
| `wieldBow` | the bow taken by the left fist: stave along the fist (the hand's y), its back out past the knuckles, so the bow arm aims it | `r.wieldBow = 1; r.reach = [{ at: bowHand, haft: [0, 0, 1] }, ...]` — `haft` stands the stave upright; lean `haft` for a cant (`[-sin a, 0, cos a]`), back for a lofted shot; or turn `hand[0]` |
| `draw` | the string pulled from straight to the right hand's fingers (0..1), bent at the nock | `r.draw = one(t, [[0.1, 0], [b.top, 1], [b.let, 1], [b.let + 0.01, 0]])` |
| `nocked` | an arrow on the string, nock at the string, shaft over the bow hand (length from the bow); `2` two arrows, the second nocked beside the first and fanned up the stave | `r.nocked = t < b.let`, `r.nocked = t < b.let ? 2 : false` |
| `arrowHand` | an arrow in the free right hand (a bow in the left): through the fist as a haft is held, a fifth of the way up from its nock, turned by `haft` | `r.arrowHand = t > 0.1 && t < 0.3` (fetched from the quiver, carried to the string) |
| `stow` | what is in the hands put away for the cast (0..1, put away past 0.5), blended in and out with the cast: a knife sheathed to dress a wound, a maul slung to lay both hands on somebody | `r.stow = 1` — bring the hand to the hip first (`reach`) for it to be seen going |
| `thrown` | the right hand emptied: the weapon is not drawn at all, nothing is slung on the back, the shield stays on the arm (unlike `stowed`) | `r.thrown = t > b.let` |
| `both` | the other hand on the haft (0..1), closed on it: for a fist or shouldered weapon the hand is **solved onto the haft** `bothAt` from the first fist (default: down the grip toward the pommel/butt, or up the haft of an axe/maul held by its end); for `wieldStaff`, see above | `r.both = 1` (and `r.bothAt = -1.2` to choose the spot, units along the weapon, + toward the head) |
| `haft` | degrees the weapon is turned in the fist toward the line of the forearm, past the knuckles — what a bent wrist would do, without bending it | maul/axe (shouldered) at the blow: `r.haft = 75`; blade with `wield`: `r.haft = 150` is a **reverse grip**, point down out of the bottom of the fist; spear with `wieldStaff`: `-90` is square across the fist, `0` along the forearm |
| `slide` | the weapon slid through the fist toward its point (units): the fist nearer the butt | `r.slide = 2` for a long thrust |
| `reach` | each hand put at a place: `[left, right]`, each `{ at, pole?, haft?, w?, stoop? }`. `at` is the middle of the hand in the body's frame from the middle of its feet (the frame `figureJoint` returns), `pole` where the elbow goes, `haft` a direction the fist closes along, `w` the share, `stoop` bows the trunk forward as little as gets the hand there (to the ground from a kneel). Solved for the caster's own build after the pose; blended in from where the hand was | `r.reach = [undefined, { at: [1.5, 2, 0.3], stoop: true }]` |
| `shape` | per hand `[left, right]`, shares of `claw`, `cup`, `flat`, `point`, `two`, blended from a closed hand (all one mesh, so any mix works); over `open`/`loose`. A held weapon is still drawn in a shaped hand (`cup` reads as a loose hold). Palm up is the hand's roll | `r.shape = [undefined, { claw: 1 }]`, `{ point: 0.7, flat: 0.3 }` |
| `mouth` | open mouth: 0.2..0.7 half open, 0.7+ a shout | `r.mouth = one(t, [[0, 0], [b.let, 1], [1, 0]])` |
| `kneel`, `kneelLeft` | down on one knee (the right unless `kneelLeft`): knee on the ground, toes tucked under, the other foot flat ahead, the body let down onto the knee; not on the move | `r.kneel = 1`; reach the ground with `reach` + `stoop` |

Exports from `../figure` for poses and effects:

- `figureJoint(pose, bone, at?)` also knows what is held, wherever the carry and the cast put it: `'weapon'` (`at` in
  the weapon's own frame: z along it from butt to point, nought at the fist), `'tip'`, `'butt'`, `'grip'` (the fist
  holding it), `'bowTop'`, `'bowBottom'` (where the string is made fast), `'nock'` (the string, drawn or not),
  `'arrow'` (the arrow's point). With nothing held these are the right fist. Through the kit: `k.joint(body, 'tip')`.
- `figureJoints(pose, ['tip', ['weapon', [0, 0, 3]], 'wrist1'])` — many points from **one** posing (a blade's trail).
- `weaponSpan(id)` — a weapon's own measures: `from` (butt), `to` (point), `fist` (where a shouldering fist closes),
  and for a bow `tips` (lower, upper, in the bow's frame), `rest` (where the arrow lies), `arrow` (its length).
- `figureProportions(look?)` — hips height, spine, chest, right shoulder in the chest's frame, upper arm, forearm,
  fist below the wrist, hip joint, thigh, shin.
- `reachHand(r, k, at, { pole, haft, w, look })` — the same solve as `reach`, done now inside your pose.
- `armToward(k, dir, bend?)` — the `arm[k]` that points the upper arm along `dir` in the chest's frame.

**The arm "out" flip** (use `armOut`, above). `arm[k]` is a pitch forward, then a roll out, then a yaw, each about the chest's axes. Past 90°
forward the arm is above the shoulder, and rolling it "out" about the forward axis carries the hand back across the
body — `[130, 35, 0]` crosses the arms over the head. This is kept (the stand-ins rely on it); to raise an arm
ahead and out, point it: `r.arm[1] = armToward(1, [0.55, 0.5, 0.67])`, or place the hand with `reach`.

## The effects: `k` (an `FxScene`, kit.ts)

Where (`P3` = `{ x, y }` tiles, `z` height units = 0.1 m from the sea; a person is ~18 tall):
`k.caster`, `k.target` (the caster again for a spell on oneself), `k.spot` (where it lands on the ground),
`k.companion` (the caster's companion — yours, or a peer's real beast, which their cast now says), `k.from` (where the
caster stood before a move the island made, or null), `k.dist` (tiles), `k.hand(1|0)`, `k.chest()`,
`k.head()`, `k.heart(body)` (where a bolt goes in), `k.weaponAt(len)` (along the wielded blade),
`k.at(body, share)`, `k.local(body, right, ahead, up)`, `k.facingDir(body)`, `k.toward(a, b)`, `k.on(x, y, lift)`.
Hands and head follow the actual posed figure, frame by frame.

Who is in reach: `k.enemiesWithin(r, c = k.spot)` — the creatures anybody may harm (wild ones; not a companion, not a
beast on a deed or in a pen, yours or anybody's): **what an area harm strikes** (a ricochet, a fan of blades, a
judgment). `k.bodiesWithin(r, c = k.spot, kinds?)` → every person and creature standing within `r` tiles of `c`
(the caster among them when inside), each a `Body` whose `kind` ('player' | 'peer' | 'creature') and `who` tell them
apart. Asked of the world once a frame for the same numbers: this is who is there. **Who the cast reached** is what the
island says (`k.told`, below), through `k.struck(r, c)` (the creatures it struck: blows that landed, fire that took,
flights, holds; `enemiesWithin(r, c)` where it said nothing) and `k.reached(r, c, kinds)` (everybody it reached: a
Rally's people, a Sanctuary's skins; `bodiesWithin(r, c, kinds)` where it said nothing). Lay a skin on every ally a
ward covered, a mark on every creature a judgment hit:
`for (const b of k.reached(k.fx.reach, k.caster, ['player', 'peer'])) k.shell(b, ...)`.

A creature body also carries `species` (for `k.muzzle`), `reach` (how near it strikes from, in tiles: 1.1, or 6 for
a thrower — a reach advantage is measured from it), `tame`, `companion`, `hostile` (hunting or fighting somebody), and
`wide` is now its kind's own width (`creatureWide`: from its model, five for the ulva; an ogre is broader).
`k.muzzle(b)` is a creature's head, where its jaws are, from its own model (a person's head; up its height for a kind
with no model).

What is on a creature, where the island's payload says: `k.target.burning` (a Kindler's burn running — Combust),
`k.target.bleeding` (a knife's bleed running), `k.target.held` (a trap holding it, or a hold an earlier cast was told
of — a Bind, a Lock, a Skull Crack, an Earthshaker, a Still field — for as long as the island said it holds: a Shatter
on one is the larger). People carry none of these, and no other mark is in the payload.

### What the island says a cast did: `k.told`

The island tells the caster what each cast did (`rpc_cast_spell`'s answer, `fx_told`), and the caster's browser passes
it on with the cast, so every browser drawing it has the same. `k.told` is null where it says nothing (an island from
before it; the preview with `told: false`): every helper below then falls back to what stands near, as before.

| field | what | read it with |
|---|---|---|
| `hit` | who it reached, each `{ who, secs?, held? }`, in the order it reached them | `k.hit` (the bodies, where they are this frame), `k.struck`, `k.reached`, `k.reachedOn(b)` |
| `hit[].secs` | seconds what it left on that one lasts: a hold, a root, a flight (a monster's Panic 3 s), a burn, a bleed, a slow, a mark, a buff | `k.secsOn(b, otherwise)` |
| `hit[].held` | it holds that one still (neither moving nor striking) | `k.heldOn(b, otherwise)` |
| `used` | the caster's waiting spells it spent: `kindler_stoke`, `warder_thicken` | on the spent one's own cast `k.used`, seconds since (−1 while it waits); on the cast that spent it `k.told.used` (a skin laid with a Thicken is `fx.more` as large) |
| `size` | the largest skin it laid, or the skin a Ward Burst broke, as a share of health | `k.told.size` |
| `low` | an Execute on a creature below its line: the 300% stroke | `k.told.low` |

And what fires after a cast, on its own (a Ward Link laying a skin back over somebody): the island tells the caster's
browser, which passes it on; the stage hands it to that cast as `k.fired`, `[{ on, age, size }]`: on whom (where they
are now), seconds since, and how large.

Where there is no island to ask (`wurm.spell` in the console, the preview), `guessTold` (`guess.ts`) works the same
fields out by the island's rules from who stands where: whom an area reaches, a monster's share of a hold, a Panic's
monsters for their own seconds, a Fright on a monster refused (and so not drawn). `supabase/test/did.ts` holds it to what
the island says.

Time and randomness: `k.now`, `k.dt`, `k.rand()` (fresh each frame — crackle), `k.seed` + `hashOf(seed, i)`
(stable per cast), `k.state` (your per-cast scratch numbers), `k.fast`, `k.mine` (your own cast), `k.zoom`,
`k.night` (0 by day to 1 at the dead of night: choose ink by day and a light tone at night), `k.released` (seconds
since the release, −1 before) and `k.castLeft` (seconds of the pose left). **`charge` is called to the end of the pose,
not only to the release** (unchanged; groups rely on it for follow-throughs): a warning that must go at the release
fades by `k.released`, one that lasts the pose fades out over its end by `k.castLeft` rather than vanishing in a frame.
`k.aim` (as `c.aim`), `k.lefty` / `k.side` (above), `k.timing`.

`k.once(name, () => point)`: a point kept for the rest of the cast from the first frame it is asked for — the tip at
the hit, so a lance or a line tied to the weapon stays put while the pose recovers instead of kinking and swinging at
the sky with the live tip.

Shapes (sizes in **pixels at zoom 1**, scaled by zoom; distances on the ground in tiles):

| pass | method | what |
|---|---|---|
| ground | `ring(c, r, {band, turn, dash, n})` | faceted band on the land, near half lit, inked rim |
| ground | `disc(c, r)`, `scorch(c, r)` | flat pool of colour / ragged burnt patch |
| ground | `sigil(c, r, {points, step, turn, grow})` | outer + inner band, star, ticks; `grow` draws it on |
| world | `orb(p, r)` | 6–8-sided lit gem with ink edge + glow |
| world | `ribbon(points, {width, taper})`, `beam(a, b)` | ribbon/trail through 3D points; `taper` 'start' (default), **'end'**, 'both', 'none' |
| world | `bolt(a, b, {jag, kinks, fork})` | jagged lightning, re-struck every frame |
| world | `slash(body, {u, from, to, tilt, reach})` | crescent cut by the blade, `u` 0..1 progress |
| world | `trail(body, {secs, inner, outer, key, edge})` | **the band the real weapon swept** over the last `secs` (0.12) of the cast, from `inner` to `outer` of the way from the fist to the point (0.4..1): the posed figure sampled every 1/60 s of the cast whatever the frame rate (so at 15 fps a blow is a smooth band, not planks), each sample posed once and kept, the head the pose already drawn; tapered to the edge at its tail (eaten, not faded), `main` with a `core` edge, inked. Mirrored casts, reverse grips, any weapon: it is where the weapon was |
| world | `aura(body, {size, width, flow, waver})` | a halo the shape of the body, hugging it (band behind, two side edges in front, wavering upward): the body's own power — a siphon, a shroud, undying — and not a skin laid on it, which is `shell` |
| world | `shell(body, {size, turn, back, lit, rim, tall})` | faceted egg round a body, back half behind it, rim in front (three fills and a stroke, however many sides). It is the Warder's skin language: to read as anything else, `lit: false` (no lit facets), `back: 0` (no back fill: a rim only), `rim` (its width), `tall` (squash or stretch), or use `aura` |
| world | `pillar(c, {r, h})` | column of light from the ground |
| world | `shards(c, {n, r, h, grow})` | crystals out of the ground |
| world | `mark(p, {r, points, turn})` | small turning rune over a head |
| world | `polyline(points, {closed, width, around})` | thin inked line through 3D points (1.2 px), sorted at its nearest point; no glow unless `glow`. `around: body` cuts it where it passes the body and sorts the far runs behind it and the near runs in front (a chain round a creature, a braid between two people); `ribbon` takes `around` too, its taper kept whole; `k.aroundBody(b, pts)` gives the runs for your own |
| world | `string(a, b, {sag, n})` | a `polyline` from a to b sagging `sag` height units at the middle (negative bows up): bowstring, tether, leash |
| world | `shapes(at, pieces, look)` | many small polygons as ONE sorted record at `at`: `pieces` = `{ pts: P3[], fill?, ink?, width?, alpha?, closed? }[]` (fill/ink `false` for none), drawn in order |
| ground | `groundPath(points, {closed, width, lift, segs})` | lines on the ground following the land, inked; `segs: [[a, b], ...]` for many separate stretches in one record |
| ground | `groundShape(x, y, r, layers)` | your own shapes on the ground, as cheap as the kit's: `layers` = `GroundLayer[]` (below) |
| glow | `glow(p, r, alpha, colour, over?)`, `flare(p, r, alpha, colour?, turn?, light?, over?)` | additive, over the night. `flare`'s `light` is its glow's colour (as `Look.light`). **`over: true` lays it over in its own colour instead of adding it**: gold, brass and blood added over grass go lime/olive; laid over they stay gold |
| light | `light(p, radiusTiles, strength, colour)` | cuts the night like a fire (max 8 at once) |
| screen | `flash(alpha)` | tint the screen; own casts only, never on fast, capped 0.3 — use for the top tier only |
| particles | `burst(p, n, opts)`, `emit(p, perSecond, opts)` | `kind`: spark, ember, mote (a small round glint, neutral), **heal** (the white "+" cross: health given back, heals only) (light, glow pass); smoke, dust, shard, drop, **mist** (things, depth-sorted; mist is a soft round puff with no edge — a breath, a vapour, a healing haze — where smoke is a hard hexagon). `over: true` draws a light kind laid over rather than added (warm sparks that must stay their colour); `ink: false` leaves a shard's dark edge off (small or bright chips) |
| body | `tint(body, {colour, share})` | a creature tinted `share` of the way to `colour` (the palette's deep) **on itself**, this frame: sick, marked, frozen. Strongest wins; a person's goes to their `veil` |
| body | `veil(body, {colour, tint, fade})` | a person's own body tinted `tint` of the way to `colour` (the palette's deep) and drawn `fade` of the way to nothing, this frame: a shroud, a stealth, a body gone to smoke. Call it every frame it is wanted, from any part (a linger too); the strongest a body is given wins |

Every shape takes a `Look`: `main`, `deep`, `core`, `ink` (palette overrides), `alpha`, `glow` (0 = none), `light`
(the glow's colour over the palette's `light`: a green heal glow off a gold Warder ring), `width`, `bias` (pixels
nearer the viewer in the sort). Raw recorders for anything else: `k.groundDraw(x, y, rTiles, g => ..., keep?)`,
`k.worldDraw(p, g => ..., bias)`, `k.glowDraw(g => ...)` — draw in screen pixels, project with `k.sx(p)`, `k.sy(p)`,
`k.px(n)` (pixels at zoom 1 → now), `k.hpx(units)`.

**Big marks on the ground.** What lies on the ground has to be cut a line of the ground at a time (so hills hide it
and bodies stand on it). The kit's own ground marks — `ring`, `disc`, `sigil`, `scorch`, `groundPath` — are recorded
as shapes on the island (`GroundLayer`s: polygons filled, lines stroked, every point a place on the ground in tiles),
which the stage cuts along the tiles' edges and lays a piece at a time with its own line, with no clip: they cost what
they cover, so an 8-tile ring or sigil can linger for half a minute. Use them, or make your own the same way:

```ts
k.groundShape(c.x, c.y, r + 0.5, [
  { kind: 'fill', colour: PALETTE.deep, alpha: 0.4, paths: [[x0, y0, x1, y1, x2, y2, ...]], lift: 0.1 },   // polygons
  { kind: 'stroke', colour: PALETTE.ink, alpha: 1, width: 2 * k.zoom, paths: [[...]], closed: true, join: 'round', lift: 0.15 },
]);
```

(`width` is in pixels as drawn, zoom included; points are flat x, y pairs in tiles; each piece is put on the land where
it is, so a shape follows the hills.) A layer's `glow: 0..1` (and `light`, its colour) lays it again in the glow pass,
lines three times as wide: **a night rim**, so a ground mark that says the mechanic still reads after dark. (Glow goes
over everything, bodies standing in front included, so keep it to rims and ticks, faint by day: `glow: k.night`.) A raw `k.groundDraw(x, y, r, g => ...)` still works as it always did, but it is
the dear way: it is drawn whole into a layer and copied out a line at a time under a clip, and a clip costs by its box.
Give it a last argument `keep(x, y, reach)` — true when it draws anything within `reach` tiles of (x, y) — and only the
ground it says yes to is cut for it (saying yes too often costs a little; saying no where it draws cuts it off).
`nearSegments(segs, x, y, reach, slack?)` (kit) is a ready `keep` for lines given flat as x0, y0, x1, y1 a segment;
`k.chordSlack(ax, ay, bx, by)` is how far a stroke drawn straight on the screen strays off the ground between two
points over uneven ground (add it to that segment's reach). Records keep their order: a kit shape recorded between two
raw `groundDraw`s is drawn with them, to stay over the one and under the other — so put your raw ones first or last.

Depth: ground shapes are cut a line of the ground at a time, so hills in front hide them and bodies stand on them.
World shapes sort with bodies, trees and walls by the ground point under them (a bolt over a head sorts with the
body under it); `shell` puts its back behind its body and its rim in front; a `ribbon`/`bolt` sorts at its nearer
end. Glow, light-kind particles and flashes go over everything, after the night.

### Going without going muddy

Fading a colour by its alpha over the ground mixes it with the grass: red half gone is olive, gold is khaki. Let a
pool or a stain **dry** — `dry(hex, u, to?)` steps it toward its own dark shade, keeping its hue (as '#rrggbb', usable
anywhere) — and let it go by alpha only at the very end, `lateFade(left, 0.2)`. Let a cut or a trail be **eaten from
its tail**: `eatTail(points, u)` is the line with its first `u` gone, opaque to the last (`trail` does this itself).

### Night

Ground marks drawn in ink and deep tones vanish at night: give them a night rim (`glow` on a ground layer,
`glow: k.night`) or choose a light tone by `k.night`. Keep a cast's lights small and warm: about 1.4 tiles and a warm
white (`'#fff1d6'`) light the ground under a spell. At night the stage now also lays each spell light's own hue over
the circle it lights (see "New API"), so a warm light reads warm on grass and a blue one blue, rather than the grass's
own green uncovered; keep the radius small all the same.
The stage now holds each cast to **two lights a frame** (eight on the screen); more are refused and the preview says so.

### Fast graphics

On fast graphics the kit's shapes draw **no glow of their own** (`k.glowOf(look)` is 0: the glow is the second copy of
everything and the first thing to go); `k.glow`, `k.flare` and `k.light` still draw. Big rings keep a few more facets
per tile out, so they stay round.

## New API (framework pass 3)

All opt-in or a fix to what was already there; a file that uses none of it is drawn as it was, but for the fixes
listed (motes, rings close up, night lights, the shadow, the trip back, `stepIn`'s back foot).

**The trip back, and footwork for `cast.close`.** The body carried in for a blow is no longer pulled back by the end of
the cast. The way back starts at `back` (the follow-through, as before) and runs on **past the cast's end** for
`CastClose.after` seconds (default 0.25 s + 0.15 s a tile, 0.4–0.6 s): about 3–4 tiles a second at the most where it was
6–14. While the stage carries the body, **the stage steps the legs**: running steps in over the wind-up, two-footed
bounds back (both feet off the ground, the body lifted, the knees drawn up, landing on bent knees, leant back), each
foot kept where it lands while the body goes over it (the figure now takes the ground going by under the body,
`Rig.ground`, so a planted foot stays put in the game too). The steps' share of the legs blends in from the pose's and
back out at the blow, so a lunge or `stepIn` at the hit is the pose's own. Past the end of the cast the figure is
still given the cast (`t` at its end, weight nought) so the legs can bound.

- **What the stage is doing, to key to:** `c.travel` in the pose and `k.travel` in the effects, a `CastTravel`
  `{ dir, by, at, gait: 'run' | 'bound', w, ground }` — the way it goes in the body's frame, how far the whole way is
  (height units), how far along (0..1), running in or bounding back, the steps' share of the legs; null/undefined
  while the body is not carried. Key a run's streaks and dust or an arm pumping to it, rather than to a copy of the
  stage's curve: that copy is now wrong on the way back, which ends `after` seconds past the cast.
- **Opt out: `close: { ..., steps: false }`** (neither way), `steps: 'in'` or `steps: 'back'` (one way only). Do not
  leave a file's own run and the stage's both on: the two strides stack. **blade.ts:** delete the five
  `dash(r, t, c, …)` calls (`measuredCut`, `lunge`, `hamstring`, `shieldBash`, `disarmingCut`) and keep the stage's
  steps; key `rush` to `k.travel` (`gait === 'run'`, `w`) instead of `pace`/`closeAt`, which assume the way back ends
  at the end of the cast. (Or keep `dash`, set `steps: false` in `closeOf`, and drive it from `c.travel`.)
- `after: 0` puts the body back by the end of the cast, as before (no reason to, now).
- The effects see the body where it is drawn (`k.caster`), all the way home; `k.castLeft` is still the pose's own.

**A close chosen by the weapon: `CastClose.when(weaponId)`.** `close: { from, to, when: (w) => !!w && isKnife(w) }`
closes only when it says yes for what is in the caster's hand (asked each frame up to the blow, kept from then).
`cast.close` is still read each frame up to the blow, so a getter keeps working; **skirmisher.ts should switch over**:
replace `get close() { return runCloses() ? RUN_CLOSE : false; }` with
`close: { ...RUN_CLOSE, when: (w) => w !== undefined && !WEAPON_BY_ID.get(w)?.thrown }` (a weapon that is not thrown,
a knife, is a blow; a javelin or an axe is thrown from where it stands) and drop `runCloses` and the map of casters'
weapons `charge` fills. The getter decided for every Hit and Run on the screen at once; `when` decides for each cast.

**`stepIn`'s back foot follows.** Past the first 3 units the lead foot carries (`LUNGE`), the back foot steps in after
it, a third of the way behind, so `by: 12` is a step and a half rather than the legs split twenty units apart. `most`
is still 12; reach is unchanged.

**The shadow follows the body.** While a cast is on a person, their shadow is under their hips as the cast has them
(`castShade` in sprites.ts, the preview too): a dart with `r.at`, a `stepIn`, a bound all take the shadow with them, and
it shrinks while the feet are off the ground. Not on the move (the walk's legs).

**Night lights read as their own colour.** At night the stage lays each spell light's hue (`lightTint`: its own hue at
85% saturation, grey for a white) over the circle it lights, as a colour (`'color'` blend) at up to 0.75 at its middle
(1.2 × strength × night). The night takes the cold wash off a light's circle, uncovering the grass as green as by day,
and adds the light's colour; a warm white added to green grass was green (the olive pools). Now a `'#fff1d6'` light at
0.5 is amber on night grass, Pikeman's blue aim light blue. Nothing changes by day, or for lights that are not spells'.

**Rings round close up.** `k.ring` and `k.disc` cut each facet finer as the ring gets bigger on the screen (`k.finer`:
a side no longer than 24 px, up to 8 times), so at zoom 3–4 a shock wave is round; at play zoom the counts are as
they were, and dashes and the glow along a ring go by the old facets. **For your own circles**, `k.roundFacets(r, most)`
is `facets` cut as finely (Blade's measure, Guardian's Call's ticks); `n:` given to `ring` is used as given.

**Motes are neutral; heals keep the cross.** `kind: 'mote'` is now a small round glint. `kind: 'heal'` is the white
"+" cross, for health given back and nothing else. A spell whose numbers are a heal (`fx.heal`: Field Dressing,
Healing Circle, Battlefield Surgery, Restoration, Miracle Worker, Lick Wounds) still draws its motes as the cross;
everywhere else switch to `'heal'` only where the spell gives health back (Regenerate, Mass Dressing).

**Kit additions.**
- `k.tint(body, { colour?, share? })`: a creature tinted on itself this frame (`share` 0.4 and the palette's deep by
  default) — sick, marked — drawn by the renderer as a blow's flash is, in your colour. People: their veil's tint.
- `k.ribbon(pts, { taper: 'end' })`: widest at the first point, nothing at the last (a beam from an eye, a thrust).
- `k.together(() => { ... })`: everything recorded inside counts as one shape in the budget. For the same mark on every
  body an area caught (a burn on each of sixteen creatures a Firestorm caught): each piece still sorts with its body.
- **Stow and draw animated:** `r.stow` from 0 to 1 now carries the weapon from the hand to where it is put away (the
  back, a hip sheath, through the belt) over the whole of the stow's rise, and back out as it falls; with the cast's
  blend-in that is about a tenth of a second. For a slower one key it: `r.stow = one(t, [[0, 0], [0.3, 1], ...])`,
  with the hand brought to the hip (`reach`) for it to be seen going.

**Preview.** `--pull`, `--peers`, `--room` (above); knives' Hit and Run at melee reach; budget warnings on stdout; a
spell on oneself gets 4 tiles of room, trimmed back to what was drawn, so a hedge or a ring round the caster is whole.

## Palettes (in each file's `PALETTE`; tweak your own)

| group | core | main | deep | accent | ink | light |
|---|---|---|---|---|---|---|
| blade | #ffffff | #c9d6e3 | #6d7f94 | #e8c35a | #27303d | #bfd8ff |
| berserker | #ffd9b0 | #d8452c | #7e1c16 | #ff9a3c | #3a0f0c | #ff6a3a |
| pikeman | #fff1c4 | #d9a441 | #8a5a22 | #7fb3d5 | #3b2610 | #ffc861 |
| archer | #f4ffd8 | #8cc56a | #3f6b2f | #e9d36a | #1d3318 | #c8f08a |
| skirmisher | #e2fff9 | #4fc2b4 | #1f6e69 | #e8c68a | #123532 | #7cf0df |
| chirurgeon | #f2fff7 | #8fe0b0 | #3d8a63 | #d65a6a | #16392a | #a6ffcf |
| beastmaster | #fff0cc | #e0a346 | #7a4e1f | #8bbf5a | #352210 | #ffc760 |
| kindler | #fff2a8 | #ff7a1a | #b3300f | #ffd23a | #4a1305 | #ff8a2a |
| binder | #eef8ff | #7fb7ff | #3b5cc4 | #c6a8ff | #141f4a | #8fc4ff |
| warder | #fffbe0 | #e8c95a | #3f9a62 | #6fe0a0 | #2a3a1a | #f2e08a |
| blessing | #fffbea | #ffd86b | #d69a2e | #ffffff | #5a3b0e | #ffe9a0 |
| justice | #f3f5ff | #9fb4ff | #4b5aa8 | #e6e8ff | #1d2350 | #b8c6ff |
| chaos | #f0c8ff | #a64dd6 | #4a1a6e | #7dff6a | #1c0828 | #b45cff |

Colours are '#rrggbb' everywhere (the kit parses them; no `rgb()` strings in a palette).

## Conventions

- **Timing.** A quick blow 0.5–0.8 s, a shot ~1 s, a big working 1.4–2 s. Release before 0.6 of the cast so the
  recovery reads. Travel ≈ 0.05–0.08 s a tile for magic, 0.04 for arrows. Impacts 0.4–0.9 s.
- **Scale.** The island is played at zoom 1–2.5: a person is 40–100 px tall, a tile 96–240 px wide. An orb of r 3
  is 3–7.5 px; a particle of size 2 is 2–5 px. Check at zoom 2 (`--zoom 2`) as well as close up.
- **Read the mechanic.** The effect should say what the spell does (a hold freezes, a burn smoulders for its
  seconds, an area spell covers exactly its radius, a skin is a shell). Big numbers, big tiers → bigger visuals.
- **Budgets per cast:** ≤ 120 particles in a burst, ≤ 60/s emitted while lingering (≤ 10/s for long lingers),
  ≤ 2 lights, ≤ 15 shapes a frame, one `flash` at most and only for tier-5/ultimate spells. The pool holds 1200
  particles for the whole screen (400 on fast graphics, where bursts are cut to a third automatically).
  No `new` canvases, no per-frame `Path2D` storms in your file; nothing kept between frames but `k.state`.
- **Style.** Faceted, flat 2–3 tones, ink edges, soft only for light. No gradients on surfaces (the pillar fade is
  the one exception). Lit from over the viewer's left shoulder (up-left lit, down-right shaded).
- Comments in British English, saying why, as the rest of the code does. No player-facing text here.

## Seeing it

Preview sheet (bundles your worktree fresh each run):

    node /home/user/Wurm/node_modules/.cache/anim/spell.mjs --root <your worktree> --spell kindler_scorch \
      --facing 1 --frames 10 --zoom 4 --target creature --out <png>

`--target creature|player|tile|self` (default: the spell's own first kind), `--dist` tiles along the ground (default:
**where the island has it** — a blow or a thrust at the weapon's own reach, 2.2 tiles for a sword or an axe and 3.2
for a spear; a Lunge 0.4 inside that after a stride from as far back as its own reach; a spell on somebody inside its
own `reach`; `--dist reach` and `--dist hunt` (1.1, where a creature comes in to strike) name the two that matter),
`--facing 0..7`, `--walk <gait>` (the caster walking on the spot through the cast, 0 a walk and 1 a run: the legs the
walk's, the cast over the arms), `--crowd N` (N more creatures about the target, or about the caster for a spell on
oneself), `--target-weapon <id>` (what a person target holds), `--pet-at heel|near|far`, `--pet-to target|caster`,
`--pet-snap <secs>` (where the companion stands and where the island puts it; by default as the spell has it: in
reach of the enemy for Sic, Drag Down, Disembowel, leaping for Pounce, onto you for Guard Me),
`--night 1` (with its light), `--fast 1`, `--secs` (cover more of the linger), `--weapon`/`--offhand`, `--cols`,
`--species`, `--companion <species>|1|0` (a companion by the caster; on by default for a Beastmaster's spells only),
`--from <tiles>` (the caster stood that far back before the island moved them: a Lunge; **negative for a leap away**
from the target, a Parting Throw's default), `--state
burning|bleeding|held` (on the target creature; bleeding by default for a Disembowel), `--pull <tiles>` (the target
stood that much further out before the island dragged it in: `cast.pull`, a Hook's default from its own numbers),
`--peers N` (N people about the target, or about the caster for a spell on oneself), `--room <tiles>` (ground round
the caster the frame takes in, trimmed back to what was drawn; 4 for a spell on oneself), `--list 1` (every id by group).
The sheet plays each cast with what the island would say it did (`guessTold`): a monster target (`--species ogre`) is
held for a monster's share, a Fright on one is refused and nothing is drawn (said on stdout). `SheetOpts.told: false`
draws it from what stands near instead, a `Told` given draws exactly that, and `SheetOpts.crowdSpecies` makes the crowd
another kind than the target (monsters among animals, for a Panic).
A throwing spell made with a weapon that is not thrown (a knife's Hit and Run) is placed at melee reach.
Frames run left to right then down; each is labelled with time and phase (cast / release / after), the facing the
caster is drawn at (turned to the companion for `face: 'companion'`, as the game turns somebody standing), and
`! …` when a cast went over its budget that frame (shapes over 15, lights over 2) or tinted the screen (`FLASH`:
keep that to the top tier); the same warnings are printed to stdout, a line a frame (`! over budget t=… …`). A long hold is squeezed to a second of the frames, so the wind-up and the letting go
still get theirs. The frame reaches a tile past the target, and room over the top for a tall effect. A cell too big
for a canvas (a big area at zoom 6) is put on more columns, or refused with a message saying so. The top of every picture is trimmed to the tallest
thing drawn in any of them, so a tall effect over a big creature is not cut off. The tool deletes its own
`/tmp/spell-*` bundle when done (and any other over an hour old). Write images under the scratchpad
`anim/<your-name>/`.

In the game: `?alone` mode, then in the console `wurm.spell('kindler_scorch')` plays it from you at whatever is
under the cursor (a creature, a person, the ground) with no island; `wurm.spell(id, { kind: 'creature', id })`,
`{ kind: 'spot', x, y }`, `{ kind: 'self' }` aim it; a third argument `{ from: { x, y }, companion: creatureId }` plays
it as though the island had moved you from there, or with that creature as your companion; `wurm.spells` lists every
id.

What it costs: `scratchpad/anim/spells/perf.mjs` times the renderer with spells going (see its header; same scratch
`vite build --outDir` site). `node perf.mjs <site> <worktree> <spell,...> 0 --every 0 --at spot` casts once and lets
it linger; it prints the median a frame of each of the stage's passes (`groundLine`, `glowPass`, ...), which is what to
compare on this loaded machine, not whole frames. `--zoom` (2), `--port` (any free one by default), `--flush
pass|frame|0`, `--frames`, `--at creature|spot|self`. A playwright driver that does
this and saves crops: `scratchpad/anim/spells/ingame.mjs` (see its header; it needs a scratch `vite build
--outDir`, never `npm run build`).

## How it is wired (so you know what you can rely on)

- Your cast: spell bar → island (`rpc_cast_spell`) → on acceptance the bar raises `game.events 'cast'` with the
  real target (creature / person / spot / self); the renderer's `SpellStage` plays it. A refusal draws nothing.
- The island's answer says what the cast did (`hit`, `secs`, `held`, `used`, `size`, `low`: `ToldWire` in
  `src/net/told.ts`); the bar raises it with the cast (`CastSeen.told`) and the stage plays it (`PlayOpts.told`, `k.told`).
- Peers: your browser then broadcasts `{uid, spell, at, pet?, from?, told?}` on the island's body channel
  (`Island.castSeen`, event `cast`): `pet` your companion's creature id, `from` where you stood if the island moved you
  for the spell, `told` what the island said it did. Other browsers raise the same event with the caster as that peer
  (`CastSeen.companion`, `CastSeen.from`, `CastSeen.told`), so they see the real beast act, the body travel and the
  real targets. Same visuals, `k.mine` false.
- What fires after a cast: the island sends `fx` `{spell, on, size}` to the caster's own topic (`fx_fired`); their
  browser raises `castFired` and passes it on (event `castfx`) for everybody watching; the stage hands it to the cast
  (`SpellStage.fired`, `k.fired`).
- Lingering effects are timed on the drawing clock from the seconds the island said (the spell's own where it said
  none); they are not restored after a reload, and end early when what they are on is gone or the island says what
  they show was spent.
