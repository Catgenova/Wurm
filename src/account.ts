import {
  PASSWORD_MIN, Unchecked, breachCount, breachWord, createAccount, foldName,
  nameEmail, nameFree, nameTrouble, passwordTrouble, passwordVerdict, signInAs,
  signOut, whoAmI,
} from './net/accounts';

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
alone.href = toGame;

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
      return settle(name, 'Welcome back.');
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
       * confirmation mail is answered — and the address is at `.invalid`, so
       * that mail reached nobody and never will. Said plainly, with the
       * setting named, because the alternative is a page that looks like it
       * worked and an account that can never be used.
       */
      return say(
        `The account ${made.name} was made, but the island keeper is holding it until a confirmation mail is answered — and ${nameEmail(made.name)} reaches no one, by design. Whoever runs the project needs to turn off "Confirm email" in its Auth settings; the account will work the moment they do.`,
        'bad',
      );
    }
    settle(made.name, `You are ${made.name} now.`);
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

/** Signed in. Say who, and hold the door open rather than leaping through it. */
function settle(name: string, line: string): void {
  card.classList.add('settled');
  say(`${line} Taking you to the island…`, 'good');
  window.setTimeout(() => { location.href = toGame; }, 900);
}

/**
 * Somebody who is already signed in does not need the form.
 *
 * `whoAmI` asks the island keeper rather than reading the name out of the
 * stored session, so what is shown here is what the database would say about
 * this browser and not what this browser would like to be true.
 */
async function onArrival(): Promise<void> {
  let name: string | null = null;
  try {
    name = await whoAmI();
  } catch {
    name = null;
  }
  if (!name) return;
  card.classList.add('settled');
  say(`Signed in as ${name}.`, 'good');
  const row = document.createElement('p');
  row.className = 'fine';
  const on = document.createElement('a');
  on.href = toGame;
  on.textContent = 'On to the island';
  const out = document.createElement('a');
  out.href = '#';
  out.textContent = 'sign out';
  out.addEventListener('click', (ev) => {
    ev.preventDefault();
    void signOut().then(() => location.reload());
  });
  row.append(on, document.createTextNode(' — or '), out, document.createTextNode(' and be somebody else.'));
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
    };
  }
}
window.wurmAccount = { nameTrouble, passwordTrouble, passwordVerdict, breachCount, breachWord, nameEmail, foldName, Unchecked };
