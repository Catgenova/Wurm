import type { UIWindow } from '../windows';

export function buildHelp(win: UIWindow): void {
  win.body.classList.add('help-body');
  win.body.innerHTML = `
    <h3>Getting around</h3>
    <table>
      <tr><td><kbd>Left click</kbd></td><td>Walk to a tile</td></tr>
      <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></td><td>Walk (screen relative)</td></tr>
      <tr><td><kbd>Drag</kbd></td><td>Look around (detaches the camera)</td></tr>
      <tr><td><kbd>Scroll</kbd> / <kbd>+</kbd> <kbd>-</kbd></td><td>Zoom</td></tr>
      <tr><td><kbd>C</kbd></td><td>Centre the camera on yourself</td></tr>
      <tr><td><kbd>Q</kbd> <kbd>E</kbd></td><td>Turn the view a quarter turn; the compass shows north</td></tr>
    </table>
    <h3>Touch screens</h3>
    <table>
      <tr><td>Tap</td><td>Walk to a tile</td></tr>
      <tr><td>Drag</td><td>Look around</td></tr>
      <tr><td>Pinch</td><td>Zoom</td></tr>
      <tr><td>Long press</td><td>Actions for a tile or tree</td></tr>
    </table>
    <h3>Doing things</h3>
    <table>
      <tr><td><kbd>Right click</kbd></td><td>Actions for a tile or tree</td></tr>
      <tr><td><kbd>Click</kbd> an item</td><td>Its actions: eat, drink, drop, examine…</td></tr>
      <tr><td><kbd>Esc</kbd></td><td>Stop the current action</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Talk in the event window</td></tr>
    </table>
    <h3>Windows</h3>
    <table>
      <tr><td><kbd>I</kbd></td><td>Inventory</td></tr>
      <tr><td><kbd>R</kbd></td><td>Crafting: everything you can make with what you carry</td></tr>
      <tr><td><kbd>K</kbd></td><td>Skills</td></tr>
      <tr><td><kbd>L</kbd></td><td>Event log</td></tr>
      <tr><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>G</kbd></td><td>Toggle the tile grid</td></tr>
      <tr><td><kbd>P</kbd></td><td>Wildermon: your tamed creatures' stats and actions</td></tr>
      <tr><td><kbd>O</kbd></td><td>Settings (tile grid, deed border)</td></tr>
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
      <tr><td>⤢ / double-click title</td><td>Expand a window to nearly the whole screen, and back</td></tr>
    </table>
    <p>Drag a window by its title bar and resize it from the bottom-right corner. The layout is remembered.</p>
    <h3>Crafting</h3>
    <p>The crafting window (<kbd>R</kbd>) is your recipe book, grouped by craft: a carving knife and a
    log give shafts or a mallet, a shaft becomes a deed stake, a saw gives planks and timbers, a chisel
    turns shards into bricks, and so on. Each recipe lists its tool and materials, green when you carry
    them and red when you do not, and whatever you can make right now sits at the top of its group. Tick
    <i>Only what I can make</i> to hide the rest. The same recipes are on each material's own menu,
    where <i>All</i> keeps going until the materials run out.</p>
    <h3>Campfires and cooking</h3>
    <p>Right-click any dry, open spot and choose <b>Build campfire</b> to lay one from two shafts; it
    fills a two by two block of the tile's spots. Feed it wooden things &mdash; shafts, thatch, planks,
    timbers, logs &mdash; and each is worth so many minutes of burning, then <b>Light</b> it. A burning
    fire is the place to <b>Cook</b>: raw meat becomes cooked meat worth twice the meal, potatoes bake
    in the embers, onions and nuts roast, and with a <b>clay bowl</b> you can stew berries into compote
    or simmer meat and vegetables into a proper stew. Cooking recipes sit in the crafting window with
    everything else and unlock when you stand by a lit fire; burning a dish costs you the ingredients,
    so cook where your skill can manage. A fire burns its fuel down in real time and goes cold when it
    runs out, and an unlit one can be taken apart to get the wood back.</p>
    <h3>Hunting and butchering</h3>
    <p>Wild wildermon can be <b>attacked</b> from their menu; an edged tool in your pack hits far harder
    than bare hands, and timid creatures bolt when hurt, so expect a chase. Whatever kills one leaves a
    <b>corpse</b> on the ground. Right-click the tile and choose <b>Butcher</b> for meat, fur, leather,
    bone and the occasional gland. The <b>Butchering</b> skill and a <b>butchering knife</b> both decide
    how much of the carcass is worth keeping: bare hands waste most of it. Corpses rot, so do it soon.</p>
    <h3>Settling and building</h3>
    <p>Carve a <b>deed stake</b> from a shaft with a carving knife, then use it where you stand to
    found a settlement: an 11 by 11
    square around a stone token. You may hold one settlement at a time, and building is only allowed
    on its land. Things left outside on deed land rot ten times slower.</p>
    <p>To build, flatten and pack a tile, then with a mallet choose <b>Plan building</b> on it and
    <b>Add to building</b> on neighbouring flat packed tiles. Point at a tile's edge and <b>Plan wall</b>
    there: solid, window, bay window, door or double door, in log, plank, timbercraft, cobblestone,
    slate, marble, sandstone, stone brick, clay adobe, clay bricks, ornate silver or ornate gold. Then
    <b>Build wall</b> feeds it materials one at a time. Floors are planned the same way and laid with
    the paving skill. Another storey can only be planned once every wall of the storey below is built.
    On an upper storey, plan a <b>staircase</b> or <b>ladder</b> instead of a plain floor to climb up:
    walk onto it from below and you are upstairs, step off it toward the ground and you are down again.
    Once the top storey's walls are done you can <b>Plan roof</b> tile by tile; neighbouring roof tiles
    join into ridges and hips.</p>
    <p>Materials: saw logs into planks and timbers, bundle cut grass into thatch, mix clay and sand
    into mortar, chisel rock, slate, marble and sandstone shards into bricks, shape clay into bricks
    or press it with grass into adobe, and chip silver and gold from veins in the mountains.</p>
    <h3>Wildermon</h3>
    <p>Wild creatures roam the island. The <b>Rabba</b> is a rabbit-like grazer that forages berries when
    hungry; the <b>Vola</b> is a mole-like digger that botanizes herbs and roots instead. Both pick that
    spot clean for a while, exactly as you would. Carry what the creature eats (a berry or vegetable for
    a Rabba, a spice or vegetable for a Vola), long-press or right-click one and choose <b>Tame</b>: the
    food is used up, success is uncommon at low taming skill, and neither species holds a failed attempt
    against you.</p>
    <p>Right-click any tile of your settlement for the <b>deed menu</b>: it lists the wildermon kept
    there, offers to <b>upgrade</b> the settlement, and renames or disbands it. Each upgrade pushes the
    border out 2 tiles and lets one more wildermon work the deed, and each has to be earned: level 2
    wants a crate and a campfire on the deed, and later levels want more crates, a fire burning,
    finished buildings and wildermon at work. The menu ticks off what you have and names what is
    missing. A settlement runs from level 1 to level 5.</p>
    <p>A deed worker starts within 8 tiles of the token and earns another 10 tiles of range for every
    10 levels of its task skill, so a seasoned one works a wide stretch of country. Its card in the
    Wildermon window shows the range it has now and how much skill the next step needs.</p>
    <p>A tamed wildermon either <b>travels with you</b> (one at a time; its stance is Passive, Defensive
    or Aggressive) or is <b>assigned to your deed</b>, where a Rabba forages around the settlement and
    drops what it finds in the deed crate beside the token. Extra tamed wildermon are kept at the token,
    whose menu lists them. Feed them from your pack; deed workers help themselves from the crate.
    The <b>Wildermon</b> window (<kbd>P</kbd>) shows the condition, level and skills of every creature
    you own; wild ones keep theirs to themselves. Deed workers learn from their work, gaining skill at
    half a player's pace and working at half a player's speed, and better skill means better quality
    finds and quicker work.</p>
    <p>Every tile is a 4 by 4 grid of spots for placing things. Build a <b>log crate</b> from three
    logs or a <b>plank crate</b> from six planks (with a mallet), then right-click the spot on a tile
    where you want it; it snaps to the grid. Crates hold 30 or 60 things, can be opened, emptied and
    picked up again when empty. The deed crate beside the token is one of them.</p>
    <p>Grass tells you what it holds: berries among the tufts mean it can be foraged, flowers mean it
    can be botanized, and grazed-bare grass has been picked over and needs time to recover.</p>
    <h3>Terraforming</h3>
    <p>Digging lowers the corner nearest to where you click (the small marker) and gives you dirt.
    Drop dirt to raise a corner. Mine rock with a pickaxe, then pave gravel with the shards or chisel
    them into bricks for cobblestone.</p>
    <p><b>Flatten</b> brings a tile level with the ground you are standing on, corner by corner:
    ground above you is scraped down and pocketed as dirt, ground below you is packed up and spends
    dirt from your pack. Stand where you want the finished height and work outwards to terrace a
    hillside. Flattening the tile under your own feet has nothing to match, so it comes down to that
    tile's lowest corner instead.</p>
    <p>Dropped items lie where you stood; the tile's menu offers to pick them up again. Anything
    left outside slowly decays, even while you are away: food rots within the hour, stone lasts for
    days, and better quality holds up longer. Fill your water skin at any shore and drink from it on
    the road.</p>
    <p>Your skills rise with everything you do. Better skill means faster, more successful actions and
    the freedom to shape steeper slopes.</p>
  `;
}
