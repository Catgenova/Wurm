/**
 * Keeping the interface on the screen it is actually on.
 *
 * Two things went wrong on a phone, and they compound.
 *
 * **The page is not always laid out the size of the screen.** Told to render a
 * desktop site — a toggle a browser will also remember on its own — a phone
 * lays the page out about 980 CSS pixels wide and shrinks the whole thing onto
 * four hundred pixels of glass. The viewport meta says `width=device-width`
 * and is simply ignored. Everything still *works*: it is a third of the size
 * it should be, the `max-width: 720px` rules never fire, and the toolbar wraps
 * into two rows across the top of a panel it was never meant to touch.
 *
 * **And then you zoom in to read it.** The interface is `position: fixed`,
 * which pins it to the *layout* viewport, so zooming leaves every panel off the
 * side of the screen. Pinching back out does not work either, because the
 * canvas takes the gesture and zooms the island instead. That is a game with
 * no interface and no way back to one, which is what was reported.
 *
 * The fix is one idea: **`#ui` is the screen, not the page.** It is placed and
 * sized against `visualViewport` — the box the eye can actually see — and
 * scaled so that its own coordinates are always about a phone's worth of room.
 * Whatever the browser has decided the page is, the interface is one screen
 * wide, laid out at a sensible width, and cannot be anywhere but in front of
 * you.
 */

/**
 * The width the interface lays itself out at when the page is wider than a
 * touchscreen wants. About a phone, so the narrow rules mean what they say.
 */
const TOUCH_UI_WIDTH = 420;

/** Past this the interface stops growing, so a big tablet is not absurd. */
const MAX_SCALE = 2.6;

/** Under this the interface calls itself narrow and stacks rather than spreads. */
export const NARROW = 720;

/**
 * Put the interface over the visible screen.
 *
 * Returns the scale it chose, which is 1 on anything ordinary.
 */
export function fitScreen(ui: HTMLElement): number {
  const vv = window.visualViewport;
  const w = vv?.width ?? window.innerWidth;
  const h = vv?.height ?? window.innerHeight;
  const left = vv?.offsetLeft ?? 0;
  const top = vv?.offsetTop ?? 0;

  /*
   * Scaled up only where the page is wider than a touchscreen would have made
   * it. A finger on a nine-hundred-pixel layout is a phone being told to
   * pretend, or a tablet being given a desktop's interface; a mouse on one is
   * a desktop, and a desktop wants its own pixels.
   */
  const touch = matchMedia('(pointer: coarse)').matches;
  const scale = touch && w > NARROW ? Math.min(MAX_SCALE, w / TOUCH_UI_WIDTH) : 1;

  ui.style.transformOrigin = '0 0';
  ui.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  ui.style.width = `${w / scale}px`;
  ui.style.height = `${h / scale}px`;
  ui.classList.toggle('narrow', w / scale <= NARROW);
  return scale;
}

/**
 * Follow the screen for as long as the page is open.
 *
 * `visualViewport` fires while a pinch is in progress as well as after it, so
 * this keeps up with the gesture rather than jumping when it ends. The window
 * events are for browsers that have no `visualViewport` at all, where the two
 * viewports are the same thing and nothing is lost.
 */
export function followScreen(ui: HTMLElement, onChange?: (scale: number) => void): void {
  const fit = (): void => {
    onChange?.(fitScreen(ui));
  };
  const vv = window.visualViewport;
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', fit);
  fit();
}

/** How far the page itself is zoomed in, 1 being not at all. */
export const pageZoom = (): number => window.visualViewport?.scale ?? 1;

/**
 * Put the page back to its own size.
 *
 * There is no API for this — a page may not set its own zoom — but a browser
 * re-reads the viewport meta when it changes, and a `maximum-scale` of one
 * makes it drop the zoom it is holding. Put back a moment later so that
 * pinching is allowed again afterwards: taking zoom away from somebody who
 * wants it is not the point, being stuck at it is.
 *
 * Does nothing where it does not work, which is the right amount of harm for a
 * trick like this.
 */
export function unzoomPage(): void {
  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  const had = meta.getAttribute('content') ?? 'width=device-width, initial-scale=1.0';
  meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  window.setTimeout(() => meta.setAttribute('content', had), 350);
}
