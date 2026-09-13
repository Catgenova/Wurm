/**
 * Dragging things from one window to another. The browser's own drag and drop
 * carries nothing but strings, so the thing being dragged is kept here and the
 * data transfer is used only to make the cursor behave.
 */
export interface DragPayload {
  /** The item being dragged. */
  uid: number;
  /** Which side it came from. */
  from: 'inventory' | 'store';
  /** What it is called, for the message when it will not go. */
  name: string;
}

let carried: DragPayload | null = null;

export const dragging = (): DragPayload | null => carried;

/** Make a row something that can be picked up and carried to another window. */
export function makeDraggable(row: HTMLElement, payload: DragPayload): void {
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    carried = payload;
    row.classList.add('drag-source');
    e.dataTransfer?.setData('text/plain', String(payload.uid));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    carried = null;
    row.classList.remove('drag-source');
  });
}

/**
 * Make an area somewhere a dragged thing can be let go of. `accept` says
 * whether this drop would work at all, which decides the cursor and the
 * highlight; `drop` does it.
 */
export function makeDropZone(el: HTMLElement, accept: (p: DragPayload) => boolean, drop: (p: DragPayload) => void): void {
  const leave = (): void => el.classList.remove('drop-target');
  el.addEventListener('dragover', (e) => {
    const p = carried;
    if (!p || !accept(p)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', leave);
  el.addEventListener('drop', (e) => {
    leave();
    const p = carried;
    if (!p || !accept(p)) return;
    e.preventDefault();
    carried = null;
    drop(p);
  });
}
