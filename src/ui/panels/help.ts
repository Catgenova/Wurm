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
    </table>
    <h3>Doing things</h3>
    <table>
      <tr><td><kbd>Right click</kbd></td><td>Actions for a tile, tree or item</td></tr>
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
      <tr><td><kbd>F1</kbd></td><td>This help</td></tr>
    </table>
    <h3>Terraforming</h3>
    <p>Digging lowers the corner nearest to where you click (the small marker) and gives you dirt.
    Drop dirt to raise a corner. Flatten evens a tile out step by step. Mine rock with a pickaxe,
    then pave gravel with the shards or chisel them into bricks for cobblestone.</p>
    <p>Your skills rise with everything you do. Better skill means faster, more successful actions and
    the freedom to shape steeper slopes.</p>
  `;
}
