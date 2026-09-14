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
      <tr><td><kbd>Esc</kbd></td><td>Stop the current action and forget what is lined up</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Talk in the event window</td></tr>
    </table>
    <p>Ask for a second job while the first is still going and it <b>lines up behind it</b> rather than
    pushing it aside: it starts the moment the one in hand is done, walking you over if it needs to. The
    bar above the action shows what is waiting. You can keep <b>three</b> jobs in your head to begin
    with, and one more for every ten points of <b>mind logic</b>, which is earned by crafting. Walking
    off, stopping with <kbd>Esc</kbd> or clicking somewhere else forgets the lot.</p>
    <h3>What the characteristics are for</h3>
    <p>The five characteristics start at 20 and rise slowly from the work that uses them, and each one
    does something plain:</p>
    <table>
      <tr><td><b>Body strength</b></td><td>How hard you hit. Earned by fighting.</td></tr>
      <tr><td><b>Body stamina</b></td><td>Less wind spent per action and quicker to get it back. Earned by spending it.</td></tr>
      <tr><td><b>Body control</b></td><td>Everything takes less time. Earned by doing anything at all.</td></tr>
      <tr><td><b>Mind logic</b></td><td>Jobs you can line up, and difficult crafts come out right more often. Earned by crafting.</td></tr>
      <tr><td><b>Soul strength</b></td><td>A wild animal is readier to trust you. Earned by taming, success or not.</td></tr>
    </table>
    <p><b>Climbing</b> raises the step you can take between tiles &mdash; ground that turns you back at
    the start is walkable once you have worked at it &mdash; and it is earned by walking steep ground.
    <b>Swimming</b> makes deep water less of a wade and costs less wind, and is earned by being out of
    your depth. Neither announces every scrap it picks up; both say so as they pass each whole point,
    and the Skills window (<kbd>K</kbd>) shows what each one is worth right now.</p>
    <h3>What you can see</h3>
    <p>The island starts unknown and is uncovered by walking it. Ground comes in three states, and the
    map shows all three differently.</p>
    <table>
      <tr><td><b>Unknown</b></td><td>Never laid eyes on. Nothing is drawn: no ground, no trees, and it
      cannot be clicked or acted on.</td></tr>
      <tr><td><b>In sight</b></td><td>Somebody is looking at it now. Drawn as it is, in full, with
      everything standing on it.</td></tr>
      <tr><td><b>Remembered</b></td><td>Walked, but not watched. Drawn cold and without detail, and
      <b>as it was when you last saw it</b> &mdash; fell a wood, walk away, and the map keeps the trees
      until you go back and look.</td></tr>
    </table>
    <p>How far you can see depends on where you stand and what hour it is. Fifteen tiles on the flat,
    further from a hill &mdash; height is worth real distance &mdash; and the dark takes better than half
    of it, which is what a <b>lit fire</b> is for: anything alight shows its own ground however black the
    night. A ridge hides the hollow behind it, and a wood is about three trees deep to the eye. Your
    settlement is watched while you hold it, and your own wildermon are eyes of their own wherever they
    are working.</p>
    <p>All of that is in Settings under <b>Fog of war</b>, if you would rather see the whole island at
    once.</p>
    <p>The wildlife works the same way. An island holds so much of it, but only the stretch of country
    you are walking has it in the flesh: a creature left a long way behind is <b>put back on the books</b>
    for the country it was in, and comes out again when somebody walks that way. Nothing is ever seen to
    come or go &mdash; it happens twice as far out as anyone can see &mdash; and the island keeps the same
    head of wildlife however far you wander. It is what lets the map grow without the game slowing down.</p>
    <h3>Windows</h3>
    <table>
      <tr><td><kbd>I</kbd></td><td>Inventory</td></tr>
      <tr><td><kbd>R</kbd></td><td>Crafting: everything you can make with what you carry</td></tr>
      <tr><td><kbd>T</kbd></td><td>Tile: everything you can do to the tile you last clicked</td></tr>
      <tr><td><kbd>Page Up</kbd> / <kbd>Page Down</kbd></td><td>Look at the storey above or below</td></tr>
      <tr><td><kbd>X</kbd></td><td>Cut away the walls facing you</td></tr>
      <tr><td><kbd>K</kbd></td><td>Skills</td></tr>
      <tr><td><kbd>L</kbd></td><td>Event log</td></tr>
      <tr><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>G</kbd></td><td>Toggle the tile grid</td></tr>
      <tr><td><kbd>P</kbd></td><td>Wildermon: your tamed creatures' stats and actions</td></tr>
      <tr><td><kbd>J</kbd></td><td>Journal: everything worth doing, ticking itself off</td></tr>
      <tr><td><kbd>O</kbd></td><td>Settings (tile grid, deed border)</td></tr>
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
      <tr><td>⤢ / double-click title</td><td>Expand a window to nearly the whole screen, and back</td></tr>
    </table>
    <p>Drag a window by its title bar and resize it from the bottom-right corner. The layout is remembered.</p>
    <p>The <b>map</b> (<kbd>M</kbd>) shows the same three states: dark where you have not been, dim
    where you have, and bright where somebody is looking now. The island is a thousand tiles a side, so
    the map does not try to show all of it at once: it looks at the ground you have walked and widens as
    you explore, out to the whole island once you have been round it. Click it to send the view there.</p>
    <p>Clicking a tile <b>chooses</b> it: it is outlined in the world and the <b>Tile</b> window fills
    with everything you could do to it &mdash; the same list the right-click menu shows, because it is
    built from the same list. Anything with a reason it cannot be done yet is greyed out with the reason
    beside it, and a row with a <b>&#9656;</b> opens in place. It works on whatever you clicked, not just
    bare ground: a chest, a smelter, a campfire, a wildermon. The game can be played from it with one
    button, which is what it is for. If you would rather keep to the right-click menu, untick
    <i>Open the tile window on a click</i> in Settings and it will stay where you put it.</p>
    <p><b>Trees are picked by their ground, not their canopy.</b> A mature tree is drawn leaning over
    the tiles behind it; the tile it stands on is the one that answers to a click or a hover, so the
    cursor never latches onto a tree it is nowhere near.</p>
    <p>The <b>inventory</b> and the <b>crafting</b> window each have a <b>search box</b> at the top.
    The inventory searches what you are carrying by name and kind; the recipe book searches on
    everything in a row at once &mdash; what it makes, the trade it takes, where it has to be worked and
    what goes into it &mdash; so <i>leather</i> finds every leather thing, <i>mason</i> finds the oven
    and the well, and <i>nail</i> finds all forty-odd recipes that want nails. The count at the foot
    tells you how many matched. <kbd>Esc</kbd> in the box clears it.</p>
    <h3>The journal</h3>
    <p>There is a great deal to do on this island and nothing anywhere that says so. The <b>journal</b>
    (<kbd>J</kbd>) is that list: fifty-seven goals in seven chapters, from felling your first tree to
    taking a trade to 99. Nothing is required and nothing is rewarded &mdash; a goal is only something
    somebody thought worth doing. Each ticks itself off the moment you have done it, says so in the
    events, and stays ticked for good afterwards whatever becomes of the thing that did it.</p>
    <h3>Crafting</h3>
    <p>The crafting window (<kbd>R</kbd>) is your recipe book, grouped by craft: a carving knife and a
    log give shafts or a mallet, a shaft becomes a deed stake, a saw gives planks and timbers, a chisel
    turns shards into bricks, and so on. Each recipe lists its tool and materials, green when you carry
    them and red when you do not, and whatever you can make right now sits at the top of its group. Tick
    <i>Only what I can make</i> to hide the rest. The same recipes are on each material's own menu,
    where <i>All</i> keeps going until the materials run out.</p>
    <h3>What a thing is made of</h3>
    <p>The same bill of materials in two different woods, or two different metals, makes two different
    things. A log keeps the wood it was cut from all the way through &mdash; planks, timbers, shafts and
    whatever you nail together out of them &mdash; and a lump keeps its metal from the seam to the
    finished blade. Every wood and every metal carries the same eight numbers: how hard it is to work,
    what it weighs, how much punishment it takes, how fast it rots, what it is worth as an edge, as
    armour, as a tool, and as a box to put things in. The examine line on any item says what it is made
    of and what that lends it.</p>
    <p><b>One craft, one material.</b> You cannot nail an oak plank to a pine one and call it a chest.
    The crafting window shows what the piece would come out <i>of</i>, and picks whichever you have most
    of; click a different stack in your pack to use that one instead. Nails and the like are exempt
    &mdash; they are whatever metal they are. <b>Improving</b> is the same rule: an oak chest wants more
    oak, and a bronze blade will not take copper.</p>
    <p><b>The six woods.</b> <b>Pine</b> is soft, light and quick to work, and rots as fast as it grew.
    <b>Willow</b> and <b>birch</b> are light and springy. <b>Maple</b> is even-tempered. <b>Oak</b> is
    hard going and worth it: an oak thing takes about a third of the knocks a pine one does, holds more
    and swings harder, at the price of weight. <b>Cedar</b> barely rots at all &mdash; whatever you mean
    to leave standing in the rain, build it of cedar. A <b>bow</b> is the fussiest thing on the island:
    a short bow is tillered from <b>willow</b>, a medium bow from <b>birch</b> and a long bow from
    <b>oak</b>, and nothing else will do.</p>
    <p><b>The fourteen metals.</b> <b>Copper</b> is what everything starts in and is soft with it.
    <b>Tin</b>, <b>zinc</b>, <b>lead</b> and <b>pewter</b> are stock for alloys and nothing you would
    want to swing. <b>Bronze</b> and <b>brass</b> are the first real step up. <b>Silver</b> hardly
    tarnishes and bites anything that carries its own light half again as hard, which is what a
    <b>Lume</b> or an <b>Embra</b> is. <b>Gold</b> never decays, weighs twice what copper does and is
    good for nothing else. The four out of the deep seams are what a lifetime of mining is for:
    <b>adamantine</b> takes the keenest edge, <b>glimmersteel</b> is light and turns aside half again
    what copper does, <b>mithril</b> is lighter than the wood it is hafted to, and <b>seryll</b>
    scarcely takes a mark at all. A tool's metal decides how fast and how true it works, so a bronze
    hatchet at forty beats a copper one at fifty; a weapon's metal decides what it does; armour's metal
    decides both what it stops and what it costs you to carry.</p>
    <h3>Brewing</h3>
    <p>Fill a barrel from a well or the shore, stand at it and <b>set a brew going</b>. Four of them:
    <b>ale</b> from 12 wheat in a quarter of an hour, <b>cider</b> from 20 apples in half an hour,
    <b>mead</b> from 12 honey in forty minutes, and <b>wine</b> from 30 cherries in three quarters of an
    hour. Each takes 15 litres of water and gives back 15 litres of drink.</p>
    <p>While it is working the barrel says so and nothing can be drawn off it &mdash; and nothing hurries
    it. When it stops, draw it into a bucket like any other liquid and drink from that. The quality of
    what comes out is half what went in and half your <b>brewing</b>, and a brew that will not take
    sours the whole barrel.</p>
    <p>What brewing is <i>for</i> is the affinity. Anything drunk favours a trade the way a cooked dish
    does, and a brew carries it far longer than food &mdash; a baked potato is nine minutes and a bucket
    of wine three quarters of an hour. A barrel of the right thing before a long afternoon at the anvil
    is the single best use of an orchard.</p>
    <h3>Fishing</h3>
    <p>Splice a <b>fishing rod</b> from 2 shafts, a bowstring and a ribbon bent into a hook, stand at
    water and fish. The line reaches about three tiles, and it goes into whatever water within a cast is
    deepest &mdash; so where you stand is the whole trade. Standing inland catches nothing at all.</p>
    <p>Five fish run at five depths, and each wants a hand to match: <b>minnow</b> anywhere there is
    water, <b>perch</b> from three deep, <b>trout</b> from eight with fishing 15, <b>pike</b> from
    sixteen with fishing 35, and <b>sturgeon</b> from twenty-eight with fishing 60. A gently shelving
    beach will never give you more than perch however good you get; a sheer bank with deep water right
    off the edge will give you everything. Each goes over a fire, and what comes off it follows the size
    of the fish &mdash; a pike is four helpings and a sturgeon ten.</p>
    <p>The <b>Wadd</b>, being the one thing on the island that swims, now fishes: set one to a deed or a
    work post and it works the banks in its range and carries the catch home.</p>
    <h3>Fruit trees</h3>
    <p>Three of the nine trees bear: <b>apple</b>, <b>cherry</b> and <b>olive</b>. They grow wild here
    and there in the warm low country &mdash; about one tree in a hundred &mdash; and you can tell them
    across a field by what is hanging in them. Take a <b>sprout</b> off one with forestry and plant it,
    and you have the beginnings of an orchard.</p>
    <p>A sapling bears nothing; leave it to grow. A mature tree gives three or four of its fruit to a
    picking and an old one five or six, more as your forestry rises, and a picked tree needs a few
    minutes before there is anything on it again. Four apples and a dough bake into two <b>apple
    pies</b>, the best food on the island; a dozen cherries boil down into two jars of <b>preserves</b>;
    and ten olives crushed under a <b>quern</b> give two measures of <b>olive oil</b>, which keeps almost
    for ever.</p>
    <p>All three are also <b>woods</b>, and good ones: apple is as hard-wearing as oak and takes a finer
    edge, cherry is the best handle wood on the island, and olive is murder to work and outlasts
    everything. You get one log a tree, so an orchard felled is an orchard gone.</p>
    <h3>Farming</h3>
    <p>With a <b>rake</b> in your pack, <b>Till</b> any grass or dirt to rake it into a field. Seeds turn
    up while foraging and botanizing &mdash; vegetables and starches in the one, spices and fibres in the
    other &mdash; and a field's menu offers to <b>Sow</b> whichever you carry. A crop goes through four
    stages: sown, sprouting, growing and ripe, each drawn differently, and every crop takes its own time
    per stage, from quick mint to slow corn.</p>
    <p>Each stage can be <b>Tended</b> once, and tending is what makes a field pay: an untended crop
    gives 1 crop and 1 seed, while one tended at every stage gives <b>4 crops and 2 seeds</b>. Tending
    and tilling both train <b>Farming</b>, and your farming skill sets the quality of what you harvest.
    Harvesting leaves the ground still tilled, so a field can be sown again without raking it afresh
    &mdash; which is what lets a Seavic keep one running on its own.</p>
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
    <h3>Grain, the quern and bread</h3>
    <p>Wheat and corn are not food until they have been through a <b>quern</b>: two stones dressed flat,
    grooved and pierced, chiselled out of three rock shards by a stonecutter. Turning it is the
    <b>Milling</b> skill. Two wheat grind down to a lot of <b>flour</b>, two corn to <b>cornmeal</b>,
    and a badly ground batch is nothing but grit.</p>
    <p>Flour and a bucket of water are worked into <b>dough</b> &mdash; two rounds at a time, and the
    bucket comes back empty &mdash; and a round of dough baked on a hot stone at a lit fire is
    <b>bread</b>, which is the first food that keeps and travels. Cornmeal boiled in a clay bowl makes
    two bowls of <b>porridge</b>. Both are cooking rather than milling: the mill only makes the meal.</p>
    <h3>The oven</h3>
    <p>A campfire will cook, but it burns as much as it bakes. An <b>oven</b> is laid by a
    <b>mason</b> from ten stone bricks and four lots of mortar with a trowel, set down on a block of
    four spots like a smelter. Feed it the same wood and coal a fire takes &mdash; it holds two hours of
    it &mdash; and light it. A lit oven is a cooking fire for every purpose: everything on the Cook menu
    is there, and anything that would have burnt over an open flame comes out right, and better, because
    the bricks hold their heat evenly. It leaves ashes like any other fire, and they rake out the same
    way.</p>
    <h3>Metal</h3>
    <p>Mining a seam brings up <b>ore</b>, not finished metal. A <b>stone smelter</b> is laid up by a
    mason from 12 stone bricks and 6 mortar with a trowel &mdash; it is built in the crafting window like
    anything else, carried, and <b>set down</b> on six spots of a tile on your own deed. Take it up again
    whole when it is cold, empty and raked out. It turns ore into lumps.
    Feed it the same fuel a campfire takes (coal burns longest), light it, and charge it with ore: each
    piece takes its own time to run, longer for fine ore and stubborn metal, shorter in a better
    smelter. Draw the lumps off when they are done.</p>
    <p>Lumps of the same metal gather into one larger lump whose quality is the average of what went in,
    weighted by size, so a poor lump drags a good stack down. At a hot smelter you can also mix
    <b>alloys</b> &mdash; bronze, brass, pewter and electrum &mdash; and their quality comes from the
    metal you put in rather than from your hands; skill only decides how little is lost in the pouring.</p>
    <p>Sand fired in a smelter makes <b>moulds</b>: an anvil mould, a pan mould, heads for rakes,
    shovels, hatchets, pickaxes and knives, a sword blade and a helm. A mould wears every time it is
    filled and <b>cannot be mended</b>; a fine one is simply good for more fillings before it cracks
    through. Pour metal into an <b>anvil mould</b> at the smelter and it cools into an anvil of that
    metal, which you set down on four spots of a tile.</p>
    <p>Every other mould is taken to an <b>anvil</b>, filled with the metal of your choosing, and beaten
    out using <b>blacksmithing</b>, <b>weaponsmithing</b> or <b>armoursmithing</b>, whichever that piece
    calls for. The skill decides whether the piece comes out at all and how good it is, alongside the
    mould, the metal and the anvil. Tool heads and blades are finished by fitting a shaft to them. A
    sword hits far harder than any working tool, and a helm turns aside most of what a cornered animal
    does to you when you attack it.</p>
    <h3>Hunting and butchering</h3>
    <p>Wild wildermon can be <b>attacked</b> from their menu; an edged tool in your pack hits far harder
    than bare hands, and timid creatures bolt when hurt, so expect a chase. Whatever kills one leaves a
    <b>corpse</b> on the ground. Right-click the tile and choose <b>Butcher</b> for meat, fur, <b>hide</b>,
    bone and the occasional gland. The <b>Butchering</b> skill and a <b>butchering knife</b> both decide
    how much of the carcass is worth keeping: bare hands waste most of it. Corpses rot, so do it soon.
    A hide off a carcass is <b>raw</b> and no use for anything until it has been through lye.</p>
    <h3>Looking inside a building</h3>
    <p>Once anything is built, a small strip of arrows appears at the right-hand edge. It picks the
    <b>storey you are looking at</b>: the ceilings above it are lifted off so you can see straight down
    into that floor, and everything above it goes with them. The label reads <i>1st</i>, <i>2nd</i> and
    so on, and clicking it returns to <i>Auto</i>, which simply follows whichever storey you are
    standing on. <kbd>Page Up</kbd> and <kbd>Page Down</kbd> do the same as the arrows.</p>
    <p>The <b>◪</b> button beside them, <kbd>X</kbd>, or the matching box in Settings, <b>cuts away the
    walls facing you</b> &mdash; the ones standing between your eye and the inside of a building &mdash;
    leaving the far walls in place so the rooms still read. Together the two let you look into any
    floor of a tall building from outside it.</p>
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
    the paving skill. Another storey can only be planned once every wall of the storey below is built, up to ten in all.
    On an upper storey, plan a <b>staircase</b> or <b>ladder</b> instead of a plain floor to climb up:
    walk onto it from below and you are upstairs, step off it toward the ground and you are down again.
    Once the top storey's walls are done you can <b>Plan roof</b> tile by tile; neighbouring roof tiles
    join into ridges and hips.</p>
    <p><b>Fences, gates and half walls</b> are the same work at a fraction of the cost, and they do not
    need a building around them: point at the edge of any tile &mdash; on your deed or a mile from it,
    on packed ground or in the long grass &mdash; and choose <b>Plan fence</b>. A log fence is two logs
    where a log wall is four; a half wall is half of one. Both stop anything alive at that border,
    yourself included, which is how a paddock holds a Roxxen; a <b>fence gate</b> is the one kind you
    can walk through. Feed them materials with <b>Build fence</b> exactly as you would a wall, and take
    them down again from the same menu. Nothing rests on waist-high work: a storey cannot be planned
    over a run of fence or half wall, so if you want a floor above, the wall below has to be a wall.</p>
    <p>Materials: saw logs into planks and timbers, bundle cut grass into thatch, mix clay and sand
    into mortar, press clay and grass into adobe, and chip silver and gold from veins in the mountains.</p>
    <h3>Nails, furniture and storage</h3>
    <p>Anything that is nailed together needs <b>nails</b>, and nails need metal. Fire a <b>nail mould</b>
    from sand at a smelter: it is a gang mould with a hundred little channels in it, so one lump of metal
    beaten out on an anvil gives a hundred nails at ten grams apiece. Crates, tool heads fitted to their
    shafts and every piece of furniture take them; sawing planks, carving shafts and bundling thatch do
    not, so the early game needs no smith.</p>
    <p><b>Fine carpentry</b> is the furniture hand, separate from the carpentry that cuts the wood. With
    a mallet, planks, timbers, shafts and nails it builds twenty pieces &mdash; stool, chair, bench,
    table, long table, writing desk, bed, cot, chest, coffer, cupboard, wardrobe, shelves, bookshelf,
    larder, barrel, lectern, coat rack, planter and firewood rack. Each is carried like a crate and
    <b>set down</b> on the block of subtiles under your cursor: right-click a tile and choose
    <b>Set furniture down here</b>.</p>
    <p>Ten of the twenty hold things, and hold far more than a crate does: a coffer takes 25, a barrel or
    a firewood rack 40, a chest 60, a cupboard 80, a bookshelf 90, a wardrobe 100, shelves 120 and a
    <b>larder</b> 150, the largest storage there is. Right-click one and <b>Open</b> it to see inside, or
    stand beside it and choose <b>Put away</b> on anything you are carrying. Nothing can be picked up
    again until it has been emptied.</p>
    <h3>Bags</h3>
    <p>Three things hold other things and are carried in your pack: a <b>sack</b> of 2 cloth (40 things),
    a <b>satchel</b> of 3 leather and a ribbon (25), and a <b>backpack</b> of 6 leather and 2 ribbons
    (60). Open one from its entry in your pack, or use <i>Put it in a bag</i> on anything you are
    carrying; <i>Empty it out</i> turns the whole thing back into your pack.</p>
    <p>What is in a bag is <b>out of reach</b> until it comes out again &mdash; no recipe will draw on it
    &mdash; and one bag will not go inside another. What a bag is for is that it <b>sheds the
    weather</b>: drop a full one on the ground and what is inside rots at four fifths the rate in a
    sack, half in a satchel and two fifths in a backpack. A backpack of food and tools left at a work
    post keeps far better than the same things thrown down beside it.</p>
    <h3>Work posts</h3>
    <p>A <b>work post</b> is a settlement's worth of orders on a stake. Build one from <b>2 planks, 2
    shafts, 4 nails and a metal ribbon</b> with a mallet, then right-click a spot on any tile
    <b>outside your own borders</b> and drive it in &mdash; inside them the token already gives the
    orders, so it refuses.</p>
    <p>Set <b>one</b> wildermon to it from the post's own menu and it works out of the post exactly as it
    would work out of a settlement: the same job, the same wage of skill, only measured from the post
    instead of the token. A post is a work site rather than a settlement, so it holds its creature on a
    short rein &mdash; <b>8 tiles round a rough post and 20 round the best</b>, however much the creature
    itself has learned. Anything with room in it standing inside that circle is where the loads go, so a
    crate beside the post makes a camp that keeps itself; leave the post bare and everything is carried
    all the way home.</p>
    <p>Nothing holds a post up and it <b>rots where it stands</b>: about <b>half an hour</b> for the
    roughest and <b>three hours</b> for the best that can be made, leaning further as it goes, with one
    word of warning near the end. When it falls over, whoever was working out of it <b>comes back to
    you</b> if you are walking alone, and <b>goes to the token</b> if you already have a companion at
    your side. You can also pull a post up before it goes, and what comes up is as worn as it had
    become.</p>
    <p>A wildermon on a post is <b>not</b> on the settlement's books, so it costs none of the working
    slots your deed level allows. That, and the fact you can put one down anywhere, is what a post is
    for: a logging camp in a far wood, a digger on a clay bank, a Snout turned loose over an old ruin
    &mdash; for as long as a stake in wet ground lasts.</p>
    <h3>Bulk, rubbish, and something to pull it in</h3>
    <p>Three more things to put things in, each for a job a chest does badly.</p>
    <p>A <b>bulk storage bin</b> holds <b>400</b> of anything that stacks &mdash; bricks, ore, planks,
    grain, shards &mdash; and refuses everything that does not. It is where a quarry's output goes.</p>
    <p>A <b>trash crate</b> is built with a rotten bottom on purpose: anything put in it rots <b>thirty
    times faster</b> than it would out in the rain, and is gone in minutes. <b>Put away</b> never picks
    it, whatever you are standing beside; you have to choose <b>Throw it in the trash</b> on the thing
    itself, so nothing goes in by accident.</p>
    <p>A <b>small cart</b> holds 100 things and, once you <b>take hold of it</b>, follows you wherever
    you go until you <b>let go</b>. Load it at the mine and walk home. Only one cart at a time, and it
    will not follow you into water or up anything it cannot roll over.</p>
    <h3>Boats</h3>
    <p>Two hulls, both a carpenter's work. A <b>rowing boat</b> is 20 planks, 6 timbers, 2 shafts and 30
    nails; she carries <b>300 things</b>, wants <b>two deep</b> of water under her and is rowed, so your
    <b>body strength</b> is the engine. A <b>sailing boat</b> is 40 planks, 14 timbers, 3 shafts, 6 cloth
    for the sail, 4 ribbons and 70 nails; she carries <b>1500</b>, wants <b>four deep</b>, and the wind
    does the work, so it is <b>body control</b> that decides how much of it you waste.</p>
    <p><b>Launch</b> her by setting her down on water deep enough while you stand on the bank &mdash; she
    will not go on land and will not go in a puddle. <b>Climb aboard</b> from the shore and she moves
    with you, over any water with depth enough and over nothing else: no beaching, no dragging her over
    a sandbar. <b>Step ashore</b> puts you on the nearest dry ground, and refuses if there is none within
    reach, so bring her in before you get out.</p>
    <p>What a boat is really for, besides the coast itself, is the water under it. A line cast over the
    side of a boat in thirty feet of water reaches everything that swims &mdash; pike and sturgeon
    included &mdash; which no bank on a shelving shore will ever do.</p>
    <h3>Large carts and wagons</h3>
    <p>A small cart is a barrow you pull yourself. The two that follow are <b>driven</b>: a wildermon
    goes in the traces, you sit on the seat, and what is on the back weighs nothing at all as far as the
    wheels are concerned.</p>
    <p>Both are <b>rough carpentry</b> rather than fine, and both are built out of parts:</p>
    <ul>
      <li><b>Large wheel</b> &mdash; 4 planks, 6 shafts, a metal ribbon and 12 nails, with a mallet.</li>
      <li><b>Big axle</b> &mdash; cast in an <b>axle mould</b> on an anvil, three lumps to one.</li>
      <li><b>Metal ribbon</b> &mdash; a <b>ribbon mould</b> runs one lump out as four.</li>
      <li><b>Yoke</b> &mdash; a shaft, two leathers and four nails, stitched with an awl. One per hitch.</li>
    </ul>
    <p>A <b>large cart</b> takes 20 planks, 6 timbers, 2 large wheels, a big axle, 8 ribbons, 2 yokes
    and 40 nails. It holds <b>1000 things of any weight</b> and has two yokes: one wildermon will move
    it, two move it faster.</p>
    <p>A <b>wagon</b> takes 40 planks, 12 timbers, 4 large wheels, 2 big axles, 16 ribbons, 4 yokes and
    80 nails. It holds <b>10000 things</b> and will not stir until <b>all four yokes</b> have a
    wildermon in them.</p>
    <p>Set one down, stand beside it and <b>hitch</b> a tamed wildermon from its menu &mdash; one you
    have with you, a deed worker, or one fetched straight out of the token if you are standing on your
    own deed. Then <b>take the reins</b> and drive. How fast you go is the team's business and nothing
    else's: a quick animal gets there sooner, more of them pull better than fewer, and a hungry one
    drags its feet, so feed the team. A Seavic pair will outrun you at a walk; four Quarra will not,
    but they will shift ten thousand bricks.</p>
    <p>The team is not only the pace but the pitch: a draught beast trains <b>climbing</b> by hauling
    over bad ground, and what the team knows between them decides both how fast the wheels turn and how
    steep a step they will take. A green pair balks at a bank a worked pair goes straight up.</p>
    <p>Wheels keep to open ground: no fords, no stairs and nothing steeper than a horse would take. You
    cannot pick a vehicle up with anything on it or anything in the yokes, and a beast in the traces
    cannot be sent to the token or released until you unbuckle it.</p>
    <h3>Water: the well and the barrels</h3>
    <p>Until now water meant walking to the shore. A <b>well</b> is a mason's job &mdash; twelve stone
    bricks, mortar, shafts and nails &mdash; and once it is sunk it <b>draws its own water</b>, a little
    at a time, up to <b>50 litres</b>. How fast depends entirely on how well it was built: a poor shaft
    trickles, a fine one keeps up with a settlement. Fill a bucket or a waterskin at it exactly as you
    would at a shore, or <b>drink from it</b> where you stand.</p>
    <p><b>Barrels</b> hold liquid and nothing else, in three sizes: <b>small</b> (30 litres),
    <b>barrel</b> (80) and <b>large</b> (250). One barrel holds one liquid &mdash; water or lye, not
    both. <b>Pour</b> a full bucket in and you get the empty bucket back; point at a stack of them and
    the whole lot goes in one after another. Filling a bucket beside a barrel draws out of the barrel,
    so a large barrel of lye is a tannery's worth of work waiting to be done.</p>
    <h3>Rest, and what the cooking is for</h3>
    <p>Sleeping in a bed banks <b>rest</b> &mdash; about half the night, and more from a better bed, up
    to an hour of it held at a time. Rest burns only while you are actually working, and everything you
    do while it burns <b>teaches you twice as much</b>. The hud shows how much you have left.</p>
    <p>Every cooked dish <b>favours one trade</b>, and eating it leaves you better at that trade for a
    while &mdash; half as much again, for anything from four minutes to half an hour by how filling the
    dish was and how well it was made. Which dish favours which trade is settled when the island is
    raised and never changes on it, and no two islands agree, so <b>examine</b> a dish to see what it is
    good for. A second helping of the same thing puts the clock back rather than stacking. That is what
    the stews and the bread and the cheese are for: not the food bar, which a raw potato would fill, but
    an afternoon of carpentry that goes half again as fast.</p>
    <h3>Night, and a bed to wake in</h3>
    <p>The island keeps a clock now, shown beside your position: a full day and night passes in
    <b>twenty-four minutes</b>, an hour to the minute. The sun goes down at eight and comes up at six,
    and the world darkens between the two.</p>
    <p>A <b>bed</b> or a <b>cot</b> is worth more than the corner it stands in. Choose <b>Make this your
    home</b> and it becomes the place you wake up &mdash; whatever happens to you, wherever it happens.
    Choose <b>Sleep until morning</b> after dark and you wake at half past six with your wind back and
    some of your hurt mended; a well-made bed is a better night than a thin cot. The world does not wait
    for you: fires burn down, crops come on, kilns finish and everything left outside ages by however
    long you were under. You wake up hungry and thirsty, too.</p>
    <h3>Eating, and keeping your things</h3>
    <p>The <b>Eat</b> button beside the food bar eats the best thing you are carrying, and the
    <b>Feed</b> button on your companion's line gives it the <i>poorest</i> thing it will take, so the
    good food stays in your pack. Both are there to save hunting through the inventory.</p>
    <p><b>Tools wear out</b>, slowly. Every use puts a little damage on whatever tool the work called
    for, and a poor tool goes to pieces far faster than a good one &mdash; which is most of what quality
    is for: a rough tool is good for about three hundred jobs and a fine one for over a thousand. Damage
    also makes a tool work as though it were poorer than it is. Past <b>75 damage</b> it warns you in
    red, and again at every five points after; at 100 it breaks and is gone.</p>
    <p>Right-click anything damaged and choose <b>Repair</b>. It is its own skill: the work goes on a
    second at a time, taking damage out and a little quality with it, and you can stop whenever you
    like. A green repairer takes about half a minute to bring a badly worn tool back and costs it a
    couple of points of quality; a skilled one does the same in a few seconds for half a point. Nothing
    repairs past quality 1, so a thing mended often enough is finished in the end &mdash; but that is a
    long way off, and a good tool kept mended will outlast most of what you build with it.</p>
    <h3>Binding wounds</h3>
    <p>A wound closes on its own eventually. A dressing is faster. Cut a length of cloth into three
    <b>bandages</b> with a knife &mdash; that is the <b>First aid</b> skill &mdash; and right-click one
    to <b>bind your wounds</b>. Each strip goes on one wound and is used up; the work keeps on while
    you are still hurt and still carrying cloth. A clean dressing puts back the whole of what your
    skill and the cloth are worth, and a slipped one about a third of it.</p>
    <p>The same hands do as much for a hurt <b>wildermon</b>. Stand beside a tame one that has been in
    a fight and choose <b>Treat its wounds</b>: it takes a bandage and puts back a share of its whole
    health, which is far more forgiving than waiting for it to mend itself. A wild creature will not
    stand still for you.</p>
    <h3>What quality is worth</h3>
    <p><b>Your skill is the ceiling and your tool is the chance of reaching it.</b> Every piece of work
    comes out either at your skill in that trade or at <b>1</b>, and the quality of the tool in your
    hand is the percentage chance of the good one. The hatchet you washed ashore with is quality 20, so
    four logs in twenty come out worth having and the rest are firewood; a hatchet worked up to 90 gives
    you nine in ten. Nothing you make is ever finer than the hands that made it, so a fine tool in a
    beginner's hands still only makes beginner's work &mdash; it just stops wasting the material.</p>
    <p>Work done with no tool at all &mdash; picking berries, tending a field &mdash; has nothing to
    roll against and comes out around what your skill can do, as it always did.</p>
    <h3>Rare things</h3>
    <p>Now and again a thing comes off the bench better than the hands that made it had any right to
    produce. About <b>one thing in a hundred</b> is <b>rare</b>, one in a thousand <b>supreme</b> and one
    in ten thousand <b>fantastic</b>. Nothing brings it on &mdash; not skill, not tools, not the metal
    &mdash; and nothing you do can make it more likely; you make ten thousand ordinary things and find
    that you have one.</p>
    <p>A rare thing is <b>better at whatever it was for</b> by a tenth, a quarter or a half &mdash; an
    edge that bites, armour that turns aside more, a tool that works truer, a box that holds more
    &mdash; <b>wears and rots more slowly</b> in the same proportion, and can be <b>improved past the
    ceiling of your own skill</b> by 5, 12 or 25. They are written in their own colour in your pack.</p>
    <h3>Improving</h3>
    <p>A finished thing can be made better than it was made. Right-click it and choose <b>Improve</b>:
    each pass eats a little stock, and a success raises the quality &mdash; a great deal at first and
    very little near the end. A failure marks the piece instead, and once it is knocked about past 10
    damage you must <b>Repair</b> it before you can work on it again.</p>
    <p><b>The kit you came ashore with cannot be improved.</b> It is issued gear, serviceable and no
    more: mend it as often as you like, but there is nothing in it to work up. The first real job on
    this island is making your own tools and then bettering those, because every quality roll you will
    ever make is a roll against the tool in your hand.</p>
    <p><b>What you need depends on what it is made of.</b></p>
    <table>
      <tr><td><b>Metal</b></td><td>A <b>file</b> and a <b>whetstone</b>, and a lump of metal per pass</td></tr>
      <tr><td><b>Wood</b></td><td>A <b>carving knife</b> and a <b>file</b>, and a plank or shaft</td></tr>
      <tr><td><b>Cloth</b></td><td>A <b>needle</b>, and a length of cloth</td></tr>
      <tr><td><b>Leather</b></td><td>An <b>awl</b> and a <b>needle</b>, and a piece of tanned leather</td></tr>
      <tr><td><b>Stone</b></td><td>A <b>chisel</b> and a <b>whetstone</b>, and shards</td></tr>
    </table>
    <p>A <b>whetstone</b> is chiselled from two rock shards, and a <b>needle</b> and an <b>awl</b> are
    carved from bone with a knife, so cloth, leather, wood and stone can all be bettered long before you
    have a forge. A <b>file</b> is cast from its own mould at an anvil, which is what gates metal.</p>
    <p>The skill the work is judged by is the one that would have made the thing &mdash; blacksmithing
    for tools, weaponsmithing for weapons, chain and plate armoursmithing for their armour, bowyery for
    bows, tailoring, leatherworking, carpentry, fine carpentry and stonecutting for the rest &mdash; and
    <b>nothing can be improved past that skill</b>. Improving raises the skill as you go, so a long
    session lifts its own ceiling a little.</p>
    <h3>Ashes, lye and tanning</h3>
    <p>Nothing burns away to nothing. Any fire that has been alight a while &mdash; a <b>campfire</b>, a
    <b>smelter</b> or a <b>kiln</b> &mdash; leaves <b>ashes</b> under it, about one lot for every two
    minutes it burns, and you can <b>Take ashes</b> from it whether it is lit or cold. They pile up
    while you work, so a smelter you have been running all morning is worth raking out.</p>
    <p>A <b>bucket</b> is three planks and six nails with a mallet. Stand at any shore and <b>Fill</b>
    it; on dry land it will not fill. Two lots of ashes leached into a bucket of water make a
    <b>bucket of lye</b> &mdash; that is the <b>Alchemy</b> skill, and it is the only thing alchemy is
    for so far. Lye is sharp stuff and one bucket does one skin. <b>Empty</b> a bucket at any time to
    get the plain bucket back.</p>
    <p><b>Tanning</b> is leatherworking: a raw <b>hide</b>, a bucket of lye and a carving knife. The lye
    takes the hair off, you work the skin soft, and it comes out as <b>leather</b> with the bucket
    empty in your hand again. Leather is what every leather thing is cut from &mdash; cap, jerkin,
    sleeves, trousers and boots &mdash; and what an awl and needle work into a leather piece when you
    improve it. Fail the tanning and the hide is left too long and spoils, so tan where your skill can
    manage it.</p>
    <h3>Reeds, papyrus and books</h3>
    <p>The <b>reed beds</b> along the shallows are worth cutting. Take a knife to one and you get
    reeds; cut it again too soon and there is nothing left to take. Four reeds soaked in a bucket of
    water, split, laid crosswise and pressed give three sheets of <b>papyrus</b>, which is the
    <b>Papyrusmaking</b> skill.</p>
    <p><b>Ink</b> is the alchemist's part: a gland &mdash; the rare thing off a carcass, and until now
    good for nothing &mdash; ground with two lots of ashes into a bucket of water until it flows black.
    Six sheets, two leather boards, a lot of ink and a needle bind into a <b>book</b>.</p>
    <p>Right-click a book and <b>Study</b> it. Half an hour with it raises <b>mind logic</b>, which is
    what decides how many jobs you can keep in your head at once, and wears the pages a little as you
    go. Held in one hand it is hard going; on a <b>lectern</b>, which until now had nothing to hold, you
    get twice as much out of the same hour.</p>
    <h3>Titles and knacks</h3>
    <p>Two things come out of a long climb, and neither is asked for. Every trade hands out a
    <b>title</b> at 50, 70, 90 and 99 &mdash; Joiner, Carpenter, Master Carpenter, Legendary Carpenter
    &mdash; and you wear <b>one at a time</b>, chosen in the Skills window (<kbd>K</kbd>) and shown
    beside your position. Click the one you are wearing to take it off again.</p>
    <p>Every <b>ten points</b> of any skill also leaves a <b>knack</b> behind. It usually lands on the
    trade you were working and sometimes on one beside it &mdash; ten points of carpentry may leave you
    better at bowyery, because it is the same hands and the same wood. A knack is worth a tenth more on
    everything that trade teaches you from then on, it never wears off, and a trade holds <b>five</b> of
    them: half again on every gain, for good. They stack with a night's rest and with what you have
    eaten, and the Skills window shows how many each trade has.</p>
    <h3>Rope</h3>
    <p>Wemp is grown in a field, cut for <b>fibre</b>, and the fibre goes two ways. Spun on a spindle it
    is coarse yarn; laid up on a <b>rope tool</b> (a plank and a shaft, carved) it is <b>rope</b> &mdash;
    four fibres to a rope, on the <b>ropemaking</b> skill. Three ropes laid up again make a <b>thick
    rope</b>, which is the hawser everything heavy hangs on.</p>
    <p>Rope is not decoration. A <b>bridle</b> takes one for the reins, a <b>rowing boat</b> two, a
    <b>sailing boat</b> eight and two hawsers for her standing rigging, and a <b>well</b> a hawser to
    hang the bucket down the shaft. Keep a field of wemp if you mean to build anything that floats.</p>
    <h3>Wool, cloth and the loom</h3>
    <p>Fibre becomes cloth in two steps, and each wants its own furniture. Build a <b>spindle</b> and a
    <b>loom</b> with fine carpentry, then stand at the spindle to spin wool, cotton or wemp into
    <b>yarn</b>, and at the loom to weave three yarn into a length of <b>cloth</b>. Cloth stuffs a
    mattress, sews into clothing, and twisted into a <b>bowstring</b> it is the start of every bow.</p>
    <h3>Armour</h3>
    <p>Armour is worn a piece at a time in five places &mdash; head, chest, arms, legs and feet &mdash;
    and only counts where the blow actually lands. Right-click anything wearable and choose
    <b>Wear or wield</b>; the inventory marks what is on you.</p>
    <p>There are four kinds, each with a skill of its own that rises <b>by being hit in it</b>:
    <b>cloth</b>, sewn by tailoring, which turns aside about a sixth and weighs nothing;
    <b>leather</b>, cut from tanned hide with a knife by leatherworking, about a third; <b>chain</b>, riveted
    from moulds at an anvil by chain armoursmithing, about a half; and <b>plate</b>, beaten out whole
    by plate armoursmithing, near two thirds. Quality and the skill behind it raise all of those, and
    damage lowers them: armour wears where it is struck, and a piece beaten to nothing falls off you.
    Weight is the price &mdash; a full suit of plate slows you by a quarter and makes every action cost
    more wind, where cloth costs almost nothing.</p>
    <p>A <b>shield</b> in the off hand is different: it does not soften a blow, it stops the whole of
    one outright, and the shields skill and its quality decide how often. Two-handed weapons leave no
    hand for one.</p>
    <h3>Weapons and the bow</h3>
    <p>Every weapon belongs to a kind, and each kind is its own subskill: <b>knives</b>, <b>swords</b>,
    <b>axes</b>, <b>mauls</b>, <b>polearms</b> and <b>archery</b>. Swinging trains the weapon's own
    subskill and the <b>fighting</b> skill behind it, and both decide whether a blow lands and how hard.
    A weapon's own numbers matter as much: a hunting knife is quick and light, a maul or a battle axe is
    slow and ends things, a spear reaches a tile further than anything else, and the two-handed ones
    take the shield off your arm.</p>
    <p>Heads are cast from <b>moulds</b> at an anvil and fitted to shafts: short and long sword blades,
    axe and maul heads, spear heads, and a gang mould that turns one lump of metal into twenty-five
    <b>arrow heads</b>. A club is simply carved from a log, which is what most people start with.</p>
    <p>Bows are tillered with <b>bowyery</b> from shafts and a bowstring, in three sizes: a
    <b>short bow</b> reaches six tiles, a <b>medium bow</b> nine and a <b>long bow</b> thirteen, each
    slower to draw and heavier in the hit than the last. Arrows are made with <b>fletching</b> from a
    shaft, three heads and three feathers &mdash; and feathers come only off a bird, so the Magga and
    the Noot are the reason you have any. With a bow in hand, <b>Shoot</b> appears on any wild creature
    in range; the far end of the range is a far harder shot than the near end, and every shot spends an
    arrow.</p>
    <h3>Stonecutting</h3>
    <p><b>Stonecutting</b> is the skill that turns what a pickaxe brings out of the rock into something
    square. With a chisel, rock, slate, marble and sandstone shards become <b>bricks</b> &mdash; what
    walls, smelters and kilns are built from &mdash; or, two shards at a time, a <b>slab</b>. Slabs are
    not for building: they are paving. Choose <b>Pave (slabs)</b> on any tile with a trowel in hand and
    the slab goes down as a floor of that stone, and each of the four looks quite different from the
    others. Breaking paving up with a pickaxe usually lifts a slab out whole. Masonry still lays the
    stone; stonecutting is what cuts it.</p>
    <h3>Pottery and the kiln</h3>
    <p>Clay is dug from a clay pit with a shovel, and everything made of it is shaped cold and soft.
    <b>Pottery</b> shapes clay into <b>unfired</b> bricks, bowls, pots and jars, and green ware is no use
    to anybody: it will not hold a stew and it will not hold up a wall. Build a <b>kiln</b> from six
    stone bricks and two mortar with a trowel, carry it, and set it down anywhere the ground is dry and
    flat; take it up again when it is cold and empty. Feed it the same wood and coal a
    fire takes, pack the green ware in, and light it: each piece needs its own time at heat, and a
    well-built kiln works faster and keeps more of the potter's quality. Take the fired ware out and the
    bowl will cook, the pot makes pottage, the jar puts up preserves, and the brick will build.</p>
    <h3>Digging up the past</h3>
    <p>People lived here before you did and left their things in the ground. Right-click any soil or
    sand and choose <b>Investigate</b>: with a <b>trowel</b> and the <b>Archaeology</b> skill you go
    through the topsoil carefully, and now and then it gives up a <b>fragment</b> of something old.
    Ground you have been over is no good again for a while, so keep walking.</p>
    <p>Nothing comes out of the ground whole or sound. A fragment names what it is a piece of and which
    piece it is &mdash; <i>ancient helm 4/5</i> &mdash; and carries a good deal of damage, which
    <b>Repair</b> takes out. There are eight things under the island, from an <b>old pot</b> in two
    pieces to an <b>ancient helm</b> in five, and a relic is only recognised once your archaeology has
    come far enough to know what it is looking at. The commonplace turns up far more often than the
    rare, and the ground is kind enough to favour a piece you are still short of.</p>
    <p>With every piece in hand, right-click one and choose <b>Restore</b>. That is the
    <b>Restoration</b> skill: a success puts the thing back together, and a failure marks all the
    pieces and leaves you to mend them. What comes out is only as good as the pieces that went in, so
    a careful excavator and a patient repairer make a better relic than either alone. Some of it is
    treasure and nothing more &mdash; a statuette, a bronze mirror, a bone comb, an old lamp &mdash;
    and some of it is an <b>old file</b>, an <b>old blade</b> or an <b>ancient helm</b>, which are the
    real prize: a file before you have a forge to cast one in.</p>
    <h3>Wildermon</h3>
    <p>Wild creatures roam the island. The <b>Rabba</b> is a rabbit-like grazer that forages berries when
    hungry; the <b>Vola</b> is a mole-like digger that botanizes herbs and roots instead; the
    <b>Bevere</b> is a flat-tailed gnawer that never settles far from water, eats vegetables and
    starchy things, is placid by nature, and fells trees for its deed, carrying the logs to the crate;
    the <b>Seavic</b> is a squirrel that lives among the trees, eats acorns and nuts, is placid too, and
    runs a farm for its deed &mdash; sowing seed from the crate, tending every stage and carrying the
    harvest back. It cannot rake a field of its own, so it only works ground you have tilled. The
    <b>Mola</b> is a heavier mole built around its claws, found sitting on metal, living on spices, and
    working the seams for its deed: it takes the nearest ore no other Mola has claimed, and the quality
    of what it brings back is its own mining skill, up to whatever the seam holds, and it leaves alone
    any metal beyond its skill. Its range grows by 5
    tiles every 10 levels rather than the usual 10. The <b>Crawler</b> is a broad crab that lives on the
    sand, eats vegetables, and digs sand for its deed &mdash; a clawful at a time, taken from the highest
    corner of the tile and carried to the crate, which is where the sand for mortar and moulds comes from
    once nobody wants to dig it themselves. It is the first of the defensive sort: strike one and it
    comes straight back at you every time, and even a tamed one is never quite tamed, so now and again it
    will round on whoever is standing next to it. A helm turns the worst of that aside. Each of them picks
    that spot clean for a while, exactly as you would. The <b>Quarra</b> is a slab of a creature with a
    jaw made for stone: it sits on bare rock, eats clay, and cuts rock, slate, marble and sandstone into
    shards for the deed, which is what keeps a mason in brick. The <b>Embra</b> sleeps in the peat and
    tar of the marshes, eats nothing that has not been cooked, and keeps every fire, smelter and kiln on
    the deed fed and lit from the crate &mdash; the one chore you otherwise have to come home for. The
    <b>Magga</b> is a magpie that clears a settlement of everything dropped and forgotten and puts it in
    the crate; wild ones do the reverse, so do not leave anything lying about near their trees. The
    <b>Woola</b> is a mild grazer that does no work at all: it grows a fleece, and once it has grown you
    <b>shear</b> it with a knife for <b>wool</b>, which grows back in about a quarter of an hour. The
    <b>Ulva</b> is the first thing on this island that will come at you unprovoked: it hunts by scent
    from seven tiles off and does not stop until you are well away or it is badly hurt. It takes taming
    30 to try, and a tamed one keeps watch over the deed, going for anything wild that crosses the
    border. The
    <b>Roxxen</b> is a slab-shouldered ox that will not start anything and will finish most things that
    start with it. It does no job on a deed; it is there to be hitched, and what it learns in the traces
    (its <b>climbing</b>) decides how fast a cart or wagon goes and how steep a line the wheels will
    take. A green pair labours over ground a worked pair walks up. It also leaves the biggest carcass on
    the island by a long way. The <b>Orse</b> is long in the leg and learns the same skill, in the traces
    or under a rider: stitch a <b>saddle</b> and a <b>bridle</b>, fit both from its menu, and
    <b>mount</b> it. A green one carries you a little faster than your own legs and over the same ground;
    a well-worked one is half again as fast and goes up slopes you would have to walk round. The
    <b>Rowl</b> hunts on sight in the wild &mdash; taming 35, and even then it is unruly &mdash; and
    tamed on a deed it hunts <b>for</b> you: it works a circuit of the token, runs down anything wild
    inside it, and carries the carcasses back to storage for butchering. Its <b>fighting</b> skill is
    both its bite and its beat: it hits nearly half again as hard at mastery, and its circuit grows from
    twelve tiles to over a hundred. The <b>Noot</b> is a plump upright waddler that
    lives beside the clay pits, eats root vegetables, and digs <b>clay</b> with its bill for its deed,
    carrying it to the crate a load at a time &mdash; which is what keeps a potter in clay without
    walking the shore for it. Carry what the creature eats (a berry or vegetable for
    a Rabba, a spice or vegetable for a Vola), long-press or right-click one and choose <b>Tame</b>: the
    food is used up, success is uncommon at low taming skill, and none of them holds a failed attempt
    against you.</p>
    <p><b>Age.</b> Everything alive was born at some hour and gets older from there. A <b>young</b> one is
    two thirds the size, moves a little slower, grows no fleece and gives no milk, and is no use in the
    traces or under a saddle &mdash; but it has not learned to mistrust you, so it is half again as easy
    to tame. It is <b>grown</b> after an hour, and everything in the book describes it then. After six
    hours it is <b>old</b>: slower again and poorer in the traces, slower to grow a fleece back, but
    heavier, and an old carcass is worth a third more than a grown one. The Wildermon window says which
    it is and how long a yearling has left to grow. What was already walking about when the island was
    raised counts as grown.</p>
    <p><b>The working sorts.</b> Eighteen more wildermon came out of the same country, and most of them
    are kept for a job. The <b>Bogga</b> wallows in the marshes and cuts <b>peat and tar</b> for the
    deed. The <b>Sedra</b> is a long-necked wader that shears <b>reeds</b> at the water's edge, which is
    where papyrus starts. The <b>Holla</b> carries <b>water</b> in its throat from the shore or a well
    and pours it into your barrels. The <b>Dowse</b> will not live anywhere there is no metal under it,
    and on a deed it <b>reads the ground</b> and marks what is down there. The <b>Sappa</b> buries more
    seed than it eats, and on a deed it <b>plants sprouts</b> where the axe has been. The <b>Cobbe</b>
    carries the <b>hod</b>: brick, mortar and timber out of your stores and into whatever wall you have
    planned, one piece at a time. The <b>Tinka</b> <b>mends</b> the damaged gear in your stores. The
    <b>Middun</b> eats what is rotting on the ground and turns it into <b>compost</b>. The <b>Snout</b>
    smells out <b>buried relics</b> and marks where to dig &mdash; taming 50, and worth every point of
    it.</p>
    <p><b>Backs and traces.</b> The <b>Bura</b> does no work but carries <b>200 things</b> in panniers on
    its own back; open them from its menu. The <b>Gorral</b> is a horned cliff-goat that takes a saddle
    and goes up ground an Orse turns away from. The <b>Wadd</b> is the one mount that will swim deep
    water with a rider on it. The <b>Shaggan</b> is slower in the traces than anything else and stronger
    than all of them: four of them move a loaded wagon as though it were empty.</p>
    <p><b>Eyes and produce.</b> The <b>Warda</b> is a watcher: keep one and it sees 18 tiles for you
    wherever it stands. The <b>Quill</b> is a ground-bird you <b>pluck</b> rather than shear, for
    <b>feathers</b>, which is what keeps an archer in arrows. The <b>Cudda</b> is <b>milked</b> into an
    empty bucket, and a bucket of milk presses into three <b>cheeses</b>. The <b>Vesp</b> is a swarm
    rather than a creature: build a <b>hive</b> (6 planks, 2 shafts, a cloth and 12 nails), set it down
    on your deed and keep a tamed Vesp there, and the swarm fills it with <b>honey</b> and
    <b>beeswax</b> &mdash; and two wax with a length of yarn draw a pair of <b>candles</b>. The
    <b>Lume</b> is only ever out after dark and carries its own daylight about with it: keep one and the
    night stops being half blind.</p>
    <p>Right-click any tile of your settlement for the <b>deed menu</b>: it lists the wildermon kept
    there, sets their <b>orders</b>, offers to <b>upgrade</b> the settlement, and renames or disbands it.
    Orders apply to every wildermon on the deed at once and take effect the moment something wild
    crosses the border: <b>aggressive</b> and they break off work and go for it, <b>defensive</b> and
    they only answer what has already struck at them or at you, <b>passive</b> and they carry on working
    whatever walks in. Each upgrade pushes the
    border out 2 tiles and lets one more wildermon work the deed, and each is earned by building the
    settlement out: level 2 wants a crate and a campfire, level 3 a stone smelter, level 4 an anvil set
    down, and level 5 a building with its ground floor walled and three wildermon at work. Upgrades are
    taken in order, so each level only asks for the new thing. The menu ticks off what you have and names what is
    missing. A settlement runs from level 1 to level 5.</p>
    <p>A deed worker feeds itself: once its belly falls below a quarter it goes to whichever crate on
    the deed holds something it eats, helps itself, and goes back to work. Keep food in a crate and your
    workers will look after themselves.</p>
    <p>A deed worker starts within 8 tiles of the token and earns another 10 tiles of range for every
    10 levels of its task skill, so a seasoned one works a wide stretch of country. Its card in the
    Wildermon window shows the range it has now and how much skill the next step needs.</p>
    <p>A tamed wildermon either <b>travels with you</b> (one at a time; its stance is Passive, Defensive
    or Aggressive) or is <b>assigned to your deed</b>, where a Rabba forages around the settlement and
    drops what it finds in the settlement's storage. Extra tamed wildermon are kept at the token,
    whose menu lists them. Feed them from your pack; deed workers help themselves from storage.
    The <b>Wildermon</b> window (<kbd>P</kbd>) shows the condition, level and skills of every creature
    you own; wild ones keep theirs to themselves. Deed workers learn from their work, gaining skill at
    half a player's pace and working at half a player's speed, and better skill means better quality
    finds and quicker work.</p>
    <p>Every tile is a 4 by 4 grid of spots for placing things. Build a <b>log crate</b> from three
    logs &mdash; notched and lashed, not a nail in it &mdash; or a <b>plank crate</b> from six planks
    and twelve nails (with a mallet), then right-click the spot on a tile
    where you want it; it snaps to the grid. Crates hold 30 or 60 things, can be opened, emptied and
    picked up again when empty. The deed crate beside the token is one of them.</p>
    <p><b>Where a worker puts things.</b> A deed worker fills the deed crate first, and when that is
    full it walks to the nearest other thing on the deed that will take what it is carrying &mdash;
    another crate, a bulk bin, a chest, a larder, a cart. A <b>trash crate</b> is never chosen, so
    nothing anybody worked for ends up in it. When <b>everything on the deed is full</b> the worker
    keeps hold of its load and stands about near the token rather than tipping it on the ground, and
    says so once: empty something or build more storage and it picks up where it left off. Seed for
    sowing and wood for stoking come out of any store on the deed, not only the deed crate.</p>
    <p><b>Moving things by hand.</b> Anything in the inventory or in an open container can be
    <b>dragged</b> from one window to the other. The rules are the same as the menu's: you have to be
    standing next to the container, and it has to be willing to hold what you are giving it &mdash; a
    bulk bin will not take a tool, a barrel takes no solids, a full crate is full. It says which when
    it will not go.</p>
    <p>Grass tells you what it holds: berries among the tufts mean it can be foraged, flowers mean it
    can be botanized, and grazed-bare grass has been picked over and needs time to recover.</p>
    <h3>Blood, the brush and breeding</h3>
    <p>Every wildermon is born <b>male</b> or <b>female</b> and carries <b>three traits</b>, and the
    traits are the whole difference between one Roxxen and the next. A trait sits in one of four tiers
    &mdash; <b>common</b>, <b>rare</b>, <b>supreme</b>, <b>fantastic</b> &mdash; and what it is worth
    climbs steeply with the tier: a common trait is a few percent, a fantastic one is half again or
    better. Traits lift how fast it <b>moves</b>, how quickly it <b>works</b>, how fast what it does
    goes into it as <b>skill</b>, what it can <b>carry and pull</b>, what it <b>brings back</b>, how
    little it <b>eats</b>, how much it can <b>take</b>, how hard it <b>hits</b>, how far it
    <b>sees</b>, how far it will <b>range</b>, and how fast <b>fleece and milk</b> come back on it.</p>
    <p>A few traits are <b>communal</b> (marked &#9673;): what they lift, they lift for every wildermon
    working the same settlement or the same post, the bearer included. One <i>pack leader</i> standing
    in the field makes a whole deed quicker and brighter.</p>
    <p>What is walking about in the wild is almost all common. Better blood is <b>bred</b>, and that is
    what <b>animal husbandry</b> is for. Make a <b>brush</b> (a plank and two wool, with a carving
    knife) and <b>brush a wildermon down</b>: it puts <b>care</b> into the animal, and a cared-for beast
    works quicker, learns faster and heals as you go over it. Care runs out again over about three hours
    of being left alone, so it is a thing you keep up rather than do once.</p>
    <p>To breed, stand a <b>male</b> and a <b>female</b> of one sort within four tiles of each other,
    both <b>grown</b>, both <b>fed</b>, and neither put to a mate in the last twenty minutes, then
    choose <b>Put it to a mate</b>. You need a settlement: the young one goes to the token. If it takes,
    the female carries for about twelve minutes and then drops a young one, and what it is born with was
    settled at that moment &mdash; a sire sold, released or eaten in between has already had his say.</p>
    <p>Three slots are filled one at a time. Each is drawn from what the pair carry between them, and
    husbandry decides two things: <b>how often the parents' blood comes through</b> rather than whatever
    the wild throws up (half at no skill, nearly all at a hundred with a well-brushed pair), and
    <b>how often a trait comes through one tier better than either parent had it</b> &mdash; commons
    becoming rares, rares becoming supremes. That second chance is the whole of why husbandry is worth
    having: it is how a line climbs. A high-husbandry eye also falls on the best of what the pair carry
    rather than picking evenly.</p>
    <p>You cannot read what you do not know. <b>Look it over</b> names the traits your husbandry is good
    enough to recognise: common blood is plain to anybody, rare takes 16, supreme 36, and old blood
    takes 61 to know when it is standing in front of you. Until then the card shows only that there is
    <i>something</i> there. Only a <b>female</b> is in milk, and nothing young or past it will breed.</p>
    <h3>Terraforming</h3>
    <p>Every corner of the map has soil sitting on bedrock. <b>Digging</b> lowers the corner nearest to
    where you click (the small marker) and takes a spadeful of that soil; when the last of it is gone
    your shovel grates on rock and will go no further. Strip all four corners of a tile bare and the
    rock beneath is exposed, and the tile becomes rock &mdash; whatever kind lies there, which may be a
    seam of silver or gold. Drop dirt on a corner to bury the rock again.</p>
    <p><b>Beds of sand, clay, peat and tar</b> are not dug like that unless you want them dug. Stand on
    one and choose <b>Collect</b> &mdash; the entry names what is underfoot, <i>Collect clay</i>,
    <i>Collect tar</i> &mdash; and you fill a shovel off the top of it: the tile keeps its type, its
    corners keep their height and their soil, and the bed is there the next time you come back. It takes
    a moment longer than cutting a corner away, which is the whole of the difference. Digging the corner
    still does what it always did, for when you actually want the ground lower.</p>
    <p><b>Packing</b> is what makes a floor of the ground. A shovel treads <b>grass, dirt, lawn, steppe,
    tundra or moss</b> down into <b>packed dirt</b>: on sod it cuts the turf away first. Packed dirt is
    what a building wants under it, and it is the only thing <b>paving</b> will go on &mdash; gravel,
    cobblestone and slabs all want a hard, flat bed, and will not be laid on loose earth or on grass.
    Breaking paving up with a pickaxe leaves bare dirt, so repaving means packing it again.</p>
    <p>Eleven metals lie in the rock, and each seam needs a certain <b>mining</b> skill before it can be
    worked at all: copper and coal from the very start, then tin at 10, zinc at 20, lead at 30, silver
    at 40, gold at 50, adamantine at 60, glimmersteel at 70, mithril at 80 and seryll at 90. The rarer
    the metal, the harder it is to find as well as to work. Coal burns longer than a log, so a campfire
    will take it gladly.</p>
    <p><b>Mining</b> with a pickaxe works bare rock for what is in it. Every swing that bites gives you
    shards or metal and leaves the face standing where it was; about one swing in a hundred a slab
    comes away of its own accord and the corner drops a step. If you want the rock <i>moved</i>, that
    is <b>Chip corner</b>: the same pick at the same corner, but you are cutting the face back rather
    than working it, and it gives way about one attempt in four. What breaks away is yours either
    way.</p>
    <p>Every tile in the world sits on a particular rock of a particular quality &mdash; under grass,
    under a forest, under the sea, everywhere &mdash; settled when the world was made and unchanged by
    anything you do to the ground above it. Metal is laid far more thickly under dry land than under
    the sea, so most of what an island holds can actually be reached: about one land tile in seven
    carries some seam. <b>Prospecting</b> is how you read it. It marks every
    ore-bearing tile within range, buried or bare, and sampling where you stand names the rock, the
    mining skill any metal takes to work, the highest quality it will ever give up, and how deep it
    lies. The range starts at 3 tiles and grows by one for every 10 levels of the skill. Metal found
    under a meadow has to be dug down to before a pickaxe is any use.</p>
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
    <p><b>What a gain is worth falls away as the skill fills.</b> An ordinary action gives about
    <b>0.44</b> at level 1, <b>0.13</b> at 50, <b>0.007</b> at 90 and <b>0.0001</b> at 99 &mdash; two
    goes for the first point of a skill, a hundred and forty for the ninetieth, and something like
    <b>ten thousand</b> for the hundredth. Nobody finishes a skill in passing; the last point of one is
    a thing to go after on purpose, and the log shows it moving in ten-thousandths while you do.</p>
  `;
}
