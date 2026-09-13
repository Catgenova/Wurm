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
      <tr><td><kbd>K</kbd></td><td>Skills</td></tr>
      <tr><td><kbd>L</kbd></td><td>Event log</td></tr>
      <tr><td><kbd>M</kbd></td><td>Map</td></tr>
      <tr><td><kbd>G</kbd></td><td>Toggle the tile grid</td></tr>
      <tr><td><kbd>O</kbd></td><td>Settings (tile grid, deed border)</td></tr>
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
      <tr><td>⤢ / double-click title</td><td>Expand a window to nearly the whole screen, and back</td></tr>
    </table>
    <p>Drag a window by its title bar and resize it from the bottom-right corner. The layout is remembered.</p>
    <h3>Settling and building</h3>
    <p>Use the settlement deed in your inventory to found a settlement where you stand: an 11 by 11
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
    <h3>Terraforming</h3>
    <p>Digging lowers the corner nearest to where you click (the small marker) and gives you dirt.
    Drop dirt to raise a corner. Flatten evens a tile out step by step. Mine rock with a pickaxe,
    then pave gravel with the shards or chisel them into bricks for cobblestone.</p>
    <p>Dropped items lie where you stood; the tile's menu offers to pick them up again. Anything
    left outside slowly decays, even while you are away: food rots within the hour, stone lasts for
    days, and better quality holds up longer. Fill your water skin at any shore and drink from it on
    the road.</p>
    <p>Your skills rise with everything you do. Better skill means faster, more successful actions and
    the freedom to shape steeper slopes.</p>
  `;
}
