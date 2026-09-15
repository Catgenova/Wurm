/**
 * Asking for a name, and asking whether you are sure.
 *
 * These were `window.prompt` and `window.confirm`, which is fine on a desktop
 * and is not a dialogue at all on a phone. Chrome on Android suppresses them
 * in more cases than it documents, and once anybody has dismissed one with
 * "don't let this page create more dialogs" every later call returns null and
 * false for the rest of the session without a word. There is no event, no
 * error and nothing on the screen — the game simply looks as though it ignored
 * you.
 *
 * Reported from the island: *"Didn't prompt me for a name for my hut,
 * defaulted to Homestead"*, and then *"I try that but nothing pops up; says in
 * chat in red 'Choose a name.'"* Both halves are this: nothing was asked, so
 * nothing was typed, so the island named the settlement itself and then
 * refused to rename it.
 *
 * So the game asks in its own words, on its own canvas, in an element it owns.
 * It mounts inside the interface root rather than on `document.body`, which
 * matters on a phone: the interface is scaled by a transform there, and a
 * dialogue outside it would be drawn at a size nobody can read next to
 * everything else.
 */

/** A question on the screen, and the promise waiting on its answer. */
interface Open {
  el: HTMLElement;
  settle: (answer: string | null) => void;
}

export class Asker {
  private open: Open | null = null;

  constructor(private readonly root: HTMLElement) {}

  /**
   * Ask for a name. Resolves with what was typed, or null if it was waved off.
   *
   * The box opens with `fallback` in it, selected, so that the commonest
   * answer — take the suggestion — is one tap, and the second commonest —
   * replace it — is typing.
   */
  name(question: string, fallback: string, max = 32): Promise<string | null> {
    return this.ask(question, { text: fallback, max });
  }

  /** Ask whether to go ahead. Resolves true only for a deliberate yes. */
  async sure(question: string): Promise<boolean> {
    return (await this.ask(question, null)) !== null;
  }

  /**
   * One question at a time.
   *
   * A second one waved off the first rather than queueing behind it: two
   * dialogues on the screen at once is a way to answer the wrong one, and
   * nothing here asks twice in a row on purpose.
   */
  private ask(question: string, field: { text: string; max: number } | null): Promise<string | null> {
    this.close(null);
    return new Promise<string | null>((settle) => {
      const el = document.createElement('div');
      el.className = 'ask';
      const box = document.createElement('div');
      box.className = 'ask-box';

      const said = document.createElement('div');
      said.className = 'ask-question';
      said.textContent = question;
      box.append(said);

      let input: HTMLInputElement | null = null;
      if (field) {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'ask-input';
        input.value = field.text;
        input.maxLength = field.max;
        // A phone keyboard that offers to capitalise a name is being helpful;
        // one that offers to correct it is not.
        input.autocomplete = 'off';
        input.autocapitalize = 'words';
        input.spellcheck = false;
        box.append(input);
      }

      const buttons = document.createElement('div');
      buttons.className = 'ask-buttons';
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'tb-btn tb-small';
      no.textContent = 'Cancel';
      const yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'tb-btn tb-small ask-ok';
      yes.textContent = field ? 'Name it' : 'Yes';
      buttons.append(no, yes);
      box.append(buttons);
      el.append(box);

      const done = (answer: string | null): void => this.close(answer);
      no.addEventListener('click', () => done(null));
      yes.addEventListener('click', () => done(input ? input.value : ''));
      // A press on the dark outside is a cancel, the way every other window
      // here closes; a press inside the box is not.
      el.addEventListener('pointerdown', (e) => {
        if (e.target === el) done(null);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          done(null);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          done(input ? input.value : '');
        }
      });
      // Typing a name must not also walk the body across the island.
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('keypress', (e) => e.stopPropagation());

      this.root.append(el);
      this.open = { el, settle };
      if (input) {
        input.focus();
        input.select();
      } else {
        yes.focus();
      }
    });
  }

  /** Take the question off the screen and answer whoever was waiting on it. */
  private close(answer: string | null): void {
    const was = this.open;
    if (!was) return;
    this.open = null;
    was.el.remove();
    was.settle(answer);
  }

  /** True while something is waiting on an answer, so keys go to it and nowhere else. */
  get asking(): boolean {
    return this.open !== null;
  }
}
