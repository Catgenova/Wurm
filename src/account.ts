import {
  PASSWORD_MIN, Unchecked, breachCount, breachWord, createAccount, foldName,
  myLook, nameEmail, nameFree, nameTrouble, passwordTrouble, passwordVerdict,
  setLook, signInAs, signOut, whoAmI,
} from './net/accounts';
import { LOOK_TABLES, cleanLook, randomLook, type Look } from './game/look';
import { drawHeadshot, drawPortrait, type PortraitMotion } from './render/sprites';

/**
 * The landing page: a username, a password, and a way back in.
 *
 * It is a page of its own rather than a window inside the game, because the
 * game is a canvas that takes the whole screen and nails the document down to
 * do it, and because this is the one screen somebody might arrive at from a
 * link before they have ever seen an island.
 *
 * It does two jobs with the same two fields. Making an account and coming back
 * to one both ask for a name and a password and nothing else, so putting them
 * on separate pages would be two pages to keep in step for no gain — and a
 * page that could only ever make a *new* account would strand everybody on
 * their second visit, which is not a landing page, it is a trap.
 */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const card = document.querySelector('.card') as HTMLElement;
const form = $<HTMLFormElement>('form');
const nameBox = $<HTMLInputElement>('name');
const pwBox = $<HTMLInputElement>('pw');
const nameNote = $<HTMLParagraphElement>('name-note');
const pwNote = $<HTMLParagraphElement>('pw-note');
const go = $<HTMLButtonElement>('go');
const said = $<HTMLParagraphElement>('say');
const tabNew = $<HTMLButtonElement>('tab-new');
const tabBack = $<HTMLButtonElement>('tab-back');
const peek = $<HTMLButtonElement>('peek');
const alone = $<HTMLAnchorElement>('alone');
const lede = $<HTMLParagraphElement>('lede');
const maker = $<HTMLElement>('maker');
const mirror = $<HTMLCanvasElement>('me');
const choices = $<HTMLElement>('choices');
const roll = $<HTMLButtonElement>('roll');
const ashore = $<HTMLButtonElement>('ashore');
const turnLeft = $<HTMLButtonElement>('turn-left');
const turnRight = $<HTMLButtonElement>('turn-right');
const closeUp = $<HTMLButtonElement>('close');
const motions = $<HTMLElement>('motions');

const NAME_HELP = 'Three to twenty characters: a letter first, then letters, numbers, underscore or hyphen. It is what everybody on the island will see over your head.';
const PW_HELP_NEW = `${PASSWORD_MIN} characters at the very least, and checked against the list of passwords already known to have leaked. Neither it nor its full fingerprint leaves this page.`;
const PW_HELP_BACK = 'The one you chose when you made the account.';

/**
 * Whatever island this page was sent here on behalf of, carried through.
 *
 * A link that says "come and join my island, you will need an account" has to
 * survive the account being made, or the first thing a new player does after
 * signing up is go and find the invitation again. Only the island parameters
 * travel — there is no `next=` and no redirect target, so there is nothing
 * here that a crafted link could point somewhere else.
 */
const carried = new URLSearchParams();
for (const key of ['island', 'found', 'size', 'seed']) {
  const had = new URLSearchParams(location.search).get(key);
  if (had !== null) carried.set(key, had);
}
const toGame = `./index.html${carried.toString() ? `?${carried}` : ''}`;
/*
 * There is no longer a way past this page onto the island.
 *
 * "Or go straight ashore with no account" was here, and everybody took it —
 * which is how every body on the island came to be an anonymous session called
 * Wanderer, with its skills hanging off a uid kept in `localStorage`. The
 * single-player game below needs no name and still has none.
 */
// And the single-player game, which is still all here and still saved in this
// browser. It is a link rather than the default now: the front door opens on
// the island.
const byMyself = new URLSearchParams(carried);
byMyself.set('alone', '1');
alone.href = `./index.html?${byMyself}`;

type Mode = 'new' | 'back';
let mode: Mode = 'new';

/** What the page is saying at the bottom, and in what tone. */
function say(text: string, tone: '' | 'bad' | 'good' = ''): void {
  said.textContent = text;
  said.className = `say${tone ? ` ${tone}` : ''}`;
}

function note(el: HTMLElement, text: string, tone: '' | 'bad' | 'good' = ''): void {
  el.textContent = text;
  el.className = `note${tone ? ` ${tone}` : ''}`;
}

function setMode(next: Mode): void {
  mode = next;
  tabNew.classList.toggle('on', next === 'new');
  tabBack.classList.toggle('on', next === 'back');
  tabNew.setAttribute('aria-selected', String(next === 'new'));
  tabBack.setAttribute('aria-selected', String(next === 'back'));
  go.textContent = next === 'new' ? 'Make the account' : 'Come back in';
  pwBox.autocomplete = next === 'new' ? 'new-password' : 'current-password';
  note(nameNote, NAME_HELP);
  note(pwNote, next === 'new' ? PW_HELP_NEW : PW_HELP_BACK);
  say('');
  checkName();
}

tabNew.addEventListener('click', () => setMode('new'));
tabBack.addEventListener('click', () => setMode('back'));

peek.addEventListener('click', () => {
  const hidden = pwBox.type === 'password';
  pwBox.type = hidden ? 'text' : 'password';
  peek.textContent = hidden ? 'hide' : 'show';
  peek.setAttribute('aria-label', hidden ? 'Hide the password' : 'Show the password');
  pwBox.focus();
});

/**
 * Is the name free?
 *
 * Asked while you type, and only ever as a courtesy — the answer can go stale
 * between here and the sign-up, and the sign-up is what actually reserves the
 * name. Each answer carries the name it was about, so a slow reply about a
 * name you have since typed past is dropped rather than shown against the
 * wrong word.
 */
let asking = 0;
let timer = 0;
function checkName(): void {
  window.clearTimeout(timer);
  const typed = foldName(nameBox.value);
  if (!typed) return note(nameNote, NAME_HELP);
  const bad = nameTrouble(typed);
  if (bad) return note(nameNote, bad, 'bad');
  if (mode === 'back') return note(nameNote, `Signing in as ${typed}.`);
  note(nameNote, `Asking whether ${typed} is taken…`);
  const mine = ++asking;
  timer = window.setTimeout(() => {
    void nameFree(typed).then(
      (free) => {
        if (mine !== asking) return;
        if (free) note(nameNote, `${typed} is free.`, 'good');
        else note(nameNote, `${typed} is taken. Try another.`, 'bad');
      },
      (e: Error) => {
        if (mine !== asking) return;
        note(nameNote, `Could not ask whether ${typed} is taken (${e.message}). You can still try.`);
      },
    );
  }, 350);
}

nameBox.addEventListener('input', () => {
  // Folded as you type rather than behind your back at submit, so that the
  // name on the screen is the name you are going to get.
  const at = nameBox.selectionStart;
  const folded = nameBox.value.toLowerCase();
  if (folded !== nameBox.value) {
    nameBox.value = folded;
    if (at !== null) nameBox.setSelectionRange(at, at);
  }
  checkName();
});

pwBox.addEventListener('input', () => {
  if (mode === 'back') return note(pwNote, PW_HELP_BACK);
  const pw = pwBox.value;
  if (!pw) return note(pwNote, PW_HELP_NEW);
  const bad = passwordTrouble(pw);
  if (bad) return note(pwNote, bad, 'bad');
  note(pwNote, `${pw.length} characters. The breach list is asked when you press the button.`);
});

/**
 * Passwords already cleared against the breach list.
 *
 * So that a sign-up turned back for a taken name does not spend another round
 * trip on the same password when you try again with a different one. Only
 * clean verdicts are remembered — a failure to reach the list is exactly the
 * thing a retry is meant to retry.
 */
const cleared = new Set<string>();

async function verdictFor(pw: string): Promise<string | null> {
  if (cleared.has(pw)) return null;
  const bad = await passwordVerdict(pw);
  if (!bad) cleared.add(pw);
  return bad;
}

let busy = false;

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (busy) return;
  void attempt();
});

async function attempt(): Promise<void> {
  const name = foldName(nameBox.value);
  const pw = pwBox.value;

  const badName = nameTrouble(name);
  if (badName) {
    note(nameNote, badName, 'bad');
    nameBox.focus();
    return say(badName, 'bad');
  }

  busy = true;
  go.disabled = true;
  try {
    if (mode === 'back') {
      if (!pw) { say('And the password.', 'bad'); pwBox.focus(); return; }
      say('Looking you up…');
      await signInAs(name, pw);
      return await onward('Welcome back.');
    }

    say('Checking the password against the breach list…');
    const badPw = await verdictFor(pw);
    if (badPw) {
      note(pwNote, badPw, 'bad');
      pwBox.focus();
      return say(badPw, 'bad');
    }
    note(pwNote, 'Not on the breach list.', 'good');

    say(`Making the account…`);
    const made = await createAccount(name, pw);
    if (made.unconfirmed) {
      /**
       * Auth made the account and will not let anybody in until a
       * confirmation mail is answered — and the address is a name at a host
       * with no mailbox behind it, so that mail reached nobody and never
       * will. Said plainly, with the
       * setting named, because the alternative is a page that looks like it
       * worked and an account that can never be used.
       */
      return say(
        `The account ${made.name} was made, but the island keeper is holding it until a confirmation mail is answered — and ${nameEmail(made.name)} reaches no one, by design. Whoever runs the project needs to turn off "Confirm email" in its Auth settings; the account will work the moment they do.`,
        'bad',
      );
    }
    await onward(`You are ${made.name} now.`);
  } catch (e) {
    if (e instanceof Unchecked) {
      /**
       * Fail closed. The instruction was to deny breached passwords, and a
       * password nobody could check is not a password anybody has cleared —
       * so this is a refusal with a retry, not a warning that gets waved past.
       */
      say(`${e.message} Nothing was made: a password that cannot be checked is not one this page will let through. Press the button again to have another go.`, 'bad');
    } else {
      say(e instanceof Error ? e.message : 'Something went wrong on the way to the island keeper.', 'bad');
    }
  } finally {
    busy = false;
    go.disabled = false;
  }
}

/** Signed in and done with. Say who, and hold the door open rather than leaping through it. */
function settle(line: string): void {
  lede.textContent = LEDE_ACCOUNT;
  card.classList.remove('making');
  card.classList.add('settled');
  maker.hidden = true;
  say(`${line} Taking you to the island…`, 'good');
  window.setTimeout(() => { location.href = toGame; }, 900);
}

/**
 * Signed in, and whether that is the end of it.
 *
 * An account with no face goes to the creator rather than to the island: it is
 * the second half of setting one up, not a thing to go and find later. An
 * account that has one goes straight through — being asked about your hair
 * every time you sign in would be a worse page than one that never asked.
 */
async function onward(line: string): Promise<void> {
  let had: Look | null = null;
  try {
    had = await myLook();
  } catch {
    had = null;
  }
  if (had) {
    look = had;
    return settle(line);
  }
  say(`${line} Now, who are you?`, 'good');
  toMaker(randomLook());
}

/* ---- Step two: who you are ---------------------------------------------- */

/** What is being chosen, at this moment. */
let look: Look = randomLook();
/** The thumbnails, so that changing skin or hair colour redraws all of them, and which way round each is shown. */
const thumbs: Array<{ canvas: HTMLCanvasElement; of: (l: Look) => Look; facing: number }> = [];
/** Hair that is tied back is chosen by what it is tied into, so its thumbnail shows the back of the head. */
const FROM_BEHIND = new Set(['ponytail', 'bun', 'braid', 'locs']);
/** What the pointer is resting on or the keyboard is on, shown in the mirror until it moves off. */
let preview: Look | null = null;
/** Every row's buttons, so the selected one can be marked without rebuilding. */
const marks: Array<{ kind: keyof Look; id: string; button: HTMLButtonElement; label: HTMLElement }> = [];

const TITLES: Record<keyof Look, string> = {
  gender: 'Build', skin: 'Skin', hair: 'Hair', hairColour: 'Hair colour',
  eyes: 'Eyes', beard: 'Beard', shirt: 'Shirt', trousers: 'Trousers',
};

/**
 * Three kinds of button for three kinds of choice.
 *
 * A colour is shown as the colour — a name for it is a word you have to
 * imagine. A shape (a haircut, a beard) is shown as a head wearing it, drawn
 * with `drawHeadshot`, which is the same `head()` the island draws: a
 * thumbnail that came from anywhere else is a thumbnail that can lie about
 * what you are choosing. Only the build, which is neither a colour nor a
 * silhouette you could tell at 46 pixels, is a word.
 */
function buildChoices(): void {
  choices.textContent = '';
  thumbs.length = 0;
  marks.length = 0;
  for (const [key, table] of Object.entries(LOOK_TABLES) as Array<[keyof Look, Array<{ id: string; name: string; colour?: string }>]>) {
    const block = document.createElement('div');
    block.className = 'choice';
    const head = document.createElement('h2');
    head.textContent = TITLES[key];
    const chosen = document.createElement('span');
    head.append(chosen);
    const row = document.createElement('div');
    row.className = 'row';
    block.append(head, row);
    for (const option of table) {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = option.name;
      button.dataset.kind = key;
      button.dataset.id = option.id;
      if (option.colour) {
        button.className = 'pick swatch';
        button.style.background = option.colour;
      } else if (key === 'hair' || key === 'beard') {
        button.className = 'pick face';
        const canvas = document.createElement('canvas');
        // Drawn at the screen's own resolution, so a haircut is not chosen from a blur.
        canvas.width = canvas.height = Math.round(52 * Math.min(3, window.devicePixelRatio || 1));
        button.append(canvas);
        thumbs.push({ canvas, of: (l) => ({ ...l, [key]: option.id, ...(key === 'hair' ? {} : { hair: 'crop' }) }), facing: key === 'hair' && FROM_BEHIND.has(option.id) ? 3 : 1 });
      } else {
        button.className = 'pick word';
        button.textContent = option.name;
      }
      button.addEventListener('click', () => {
        look = cleanLook({ ...look, [key]: option.id });
        preview = null;
        redraw();
      });
      // Resting the pointer on a choice, or tabbing to it, tries it on in the mirror; moving off puts back what was chosen.
      const tryOn = (): void => { preview = cleanLook({ ...look, [key]: option.id }); };
      const takeOff = (): void => { preview = null; };
      button.addEventListener('pointerenter', tryOn);
      button.addEventListener('focus', tryOn);
      button.addEventListener('pointerleave', takeOff);
      button.addEventListener('blur', takeOff);
      marks.push({ kind: key, id: option.id, button, label: chosen });
      row.append(button);
    }
    choices.append(block);
  }
}

/** The mirror, the thumbnails and the ticks, all from the one look. */
function redraw(): void {
  for (const m of marks) {
    const on = look[m.kind] === m.id;
    m.button.classList.toggle('on', on);
    if (on) {
      const table = LOOK_TABLES[m.kind] as Array<{ id: string; name: string }>;
      m.label.textContent = table.find((o) => o.id === m.id)?.name ?? '';
    }
  }
  for (const t of thumbs) {
    const ctx = t.canvas.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, t.canvas.width, t.canvas.height);
    drawHeadshot(ctx, 0, 0, t.canvas.width, t.of(look), t.facing);
  }
}

/**
 * The mirror walks, and turns, and looks close.
 *
 * Standing still is easier to draw and worse to choose from: a walk is how you
 * will actually see yourself, and it is the only way to find out that the
 * ponytail moves and the long beard does not. It turns through the same eight
 * ways the island draws you -- by its arrows, by dragging across it, or by
 * the arrow keys -- because a haircut is chosen as much from behind as from
 * the front, and the face button brings the head up to fill it.
 */
let walking = 0;
let facing = 1;
let motion: PortraitMotion = 'walk';
let close = false;

function mirrorFrame(now: number): void {
  const ctx = mirror.getContext('2d');
  if (ctx && !maker.hidden) {
    // The backing store follows the size the page gives the mirror, at the screen's own resolution.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(mirror.clientWidth * dpr), h = Math.round(mirror.clientHeight * dpr);
    if (w > 0 && h > 0 && (mirror.width !== w || mirror.height !== h)) {
      mirror.width = w;
      mirror.height = h;
    }
    ctx.clearRect(0, 0, mirror.width, mirror.height);
    const shown = preview ?? look;
    if (close) {
      drawHeadshot(ctx, 0, 0, mirror.width, shown, facing, now / 1000, mirror.height);
    } else {
      drawPortrait(ctx, 0, 0, mirror.width, mirror.height, shown, now / 1000, facing, motion);
    }
  }
  walking = requestAnimationFrame(mirrorFrame);
}

function turn(by: number): void {
  facing = (((facing + by) % 8) + 8) % 8;
}

function showMotion(m: PortraitMotion): void {
  motion = m;
  for (const b of motions.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.motion === m));
}

turnLeft.addEventListener('click', () => turn(-1));
turnRight.addEventListener('click', () => turn(1));
closeUp.addEventListener('click', () => {
  close = !close;
  closeUp.setAttribute('aria-pressed', String(close));
});
for (const b of motions.querySelectorAll<HTMLButtonElement>('button')) {
  b.addEventListener('click', () => {
    showMotion(b.dataset.motion as PortraitMotion);
    // Asking to see a move is asking to see the body do it.
    if (close) {
      close = false;
      closeUp.setAttribute('aria-pressed', 'false');
    }
  });
}
showMotion(motion);

// Dragging across the mirror turns it an eighth for every so far dragged.
const DRAG_STEP = 26;
let dragFrom: number | null = null;
mirror.addEventListener('pointerdown', (e) => {
  dragFrom = e.clientX;
  mirror.setPointerCapture(e.pointerId);
});
mirror.addEventListener('pointermove', (e) => {
  if (dragFrom === null) return;
  const steps = Math.trunc((e.clientX - dragFrom) / DRAG_STEP);
  if (steps) {
    turn(steps);
    dragFrom += steps * DRAG_STEP;
  }
});
const letGo = (): void => { dragFrom = null; };
mirror.addEventListener('pointerup', letGo);
mirror.addEventListener('pointercancel', letGo);
mirror.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    turn(e.key === 'ArrowLeft' ? -1 : 1);
    e.preventDefault();
  }
});

const LEDE_ACCOUNT = lede.textContent ?? '';
const LEDE_MAKER = 'Skin, hair, eyes, build and what you washed ashore in. None of it is fixed — you can come back and change any of it whenever you like.';

function toMaker(start: Look): void {
  lede.textContent = LEDE_MAKER;
  look = cleanLook(start);
  card.classList.remove('settled');
  card.classList.add('making');
  maker.hidden = false;
  if (!marks.length) buildChoices();
  redraw();
  if (!walking) walking = requestAnimationFrame(mirrorFrame);
}

roll.addEventListener('click', () => {
  look = randomLook();
  redraw();
});

ashore.addEventListener('click', () => {
  void (async () => {
    ashore.disabled = true;
    say('Writing you down…');
    try {
      // What comes back is what was stored. The keeper clamps every field
      // against its own tables, so drawing anything else here would be a
      // mirror showing a face nobody else would ever see.
      look = await setLook(look);
      settle('That is you.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'The island keeper would not take that face.', 'bad');
      ashore.disabled = false;
    }
  })();
});

/**
 * Somebody who is already signed in does not need the form.
 *
 * `whoAmI` asks the island keeper rather than reading the name out of the
 * stored session, so what is shown here is what the database would say about
 * this browser and not what this browser would like to be true. An account
 * that has never chosen a face goes straight to the second step, because it
 * has not finished being set up.
 */
async function onArrival(): Promise<void> {
  let name: string | null = null;
  try {
    name = await whoAmI();
  } catch {
    name = null;
  }
  if (!name) return;
  let had: Look | null = null;
  try {
    had = await myLook();
  } catch {
    had = null;
  }
  if (!had) {
    say(`Signed in as ${name}. Now, who are you?`, 'good');
    toMaker(randomLook());
    return;
  }
  look = had;
  card.classList.add('settled');
  say(`Signed in as ${name}.`, 'good');
  const row = document.createElement('p');
  row.className = 'fine';
  const on = document.createElement('a');
  on.href = toGame;
  on.textContent = 'On to the island';
  const again = document.createElement('a');
  again.href = '#';
  again.id = 'again';
  again.textContent = 'change how you look';
  again.addEventListener('click', (ev) => {
    ev.preventDefault();
    say(`Signed in as ${name}.`, 'good');
    toMaker(had ?? randomLook());
  });
  const out = document.createElement('a');
  out.href = '#';
  out.textContent = 'sign out';
  out.addEventListener('click', (ev) => {
    ev.preventDefault();
    void signOut().then(() => location.reload());
  });
  row.append(on, document.createTextNode(' — or '), again, document.createTextNode(', or '), out,
             document.createTextNode(' and be somebody else.'));
  card.insertBefore(row, said.nextSibling);
}

setMode('new');
void onArrival();

declare global {
  interface Window {
    /** Console handle, and what the browser tests drive the rules through. */
    wurmAccount: {
      nameTrouble: typeof nameTrouble;
      passwordTrouble: typeof passwordTrouble;
      passwordVerdict: typeof passwordVerdict;
      breachCount: typeof breachCount;
      breachWord: typeof breachWord;
      nameEmail: typeof nameEmail;
      foldName: typeof foldName;
      Unchecked: typeof Unchecked;
      LOOK_TABLES: typeof LOOK_TABLES;
      cleanLook: typeof cleanLook;
      randomLook: typeof randomLook;
      /** What the creator is showing at this moment. */
      look: () => Look;
      /** Open the creator on a look without an account behind it, to look at; stepping ashore still needs one. */
      openMaker: (start?: Look) => void;
    };
  }
}
window.wurmAccount = {
  nameTrouble, passwordTrouble, passwordVerdict, breachCount, breachWord, nameEmail, foldName, Unchecked, LOOK_TABLES, cleanLook, randomLook,
  look: () => look,
  openMaker: (start) => toMaker(start ?? randomLook()),
};
