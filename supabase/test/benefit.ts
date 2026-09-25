/**
 * The exact benefit, and where its number comes from.
 *
 * `CLAUDE.md` asks two things of every line a player reads to decide what to
 * do: that it says what changes and by how much, and that where the number
 * can be derived it is, "so the text cannot drift from the rule it
 * describes". The first is a matter of judgement. The second can be counted,
 * and it had drifted: the help said a barrel holds 40 when it holds 80, a
 * brew took fifteen minutes that took thirty-eight, a work post stood half an
 * hour that stood seventy-five, and the journal said a knack came every ten
 * points while the rule rolled one in five thousand. Nothing had changed but
 * the rule; the text had simply been typed.
 *
 * Two layers, because each sees what the other cannot.
 *
 *   **The rules against their text.** Import the definitions and put each
 *   text beside the fields it talks about: a recipe's `done` beside its
 *   `count`, a piece's description beside its capacity, its litres and its
 *   bill, a bag's beside what it holds, a mould's beside how many it casts,
 *   a crate's beside its room, a bow's beside its range. At run time a
 *   number put in from the field looks exactly like one typed out, so a
 *   number is only held against the text when the words around it are also
 *   there, word for word, in the source.
 *
 *   **The source, read.** Every fixed piece of text in the fields a player
 *   reads -- `description`, `note`, `lever`, `done`, `fail`, `hint`, `how`,
 *   `said`, what goes to `logMsg` and `say`, a piece's `done`, a setting's
 *   hint and the whole of the help -- is scanned for a figure, a number
 *   word from two up, and a multiplier ("twice", "half again", "a fifth").
 *   Keys in `<kbd>`, headings, entities, ordinals and `{placeholders}` are
 *   taken out first, and "one", "once" and a bare "half" are left alone.
 *
 * What is left over and is genuinely not a rule's number -- the name of a
 * double door, a pair of hands on a two-handed weapon -- is in `NOT_A_RULE`
 * below with the reason, keyed by a snippet of the text or by the id of the
 * definition. An entry that no longer matches anything fails too, so the list
 * cannot quietly outgrow what it excuses.
 *
 * Needs no database. Run from the repository root:
 *
 *   npx esbuild supabase/test/benefit.ts --bundle --platform=node --format=esm \
 *     --external:typescript --outfile=node_modules/.cache/benefit.mjs && node node_modules/.cache/benefit.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import '../../src/game/game';
import { ITEM_DEFS } from '../../src/game/items';
import { RECIPES } from '../../src/game/recipes';
import { FURNITURE } from '../../src/game/furniture';
import { MOULDS } from '../../src/game/metal';
import { CRATE_DEFS } from '../../src/game/crates';
import { WEAPONS } from '../../src/game/gear';
import { helpText } from '../../src/ui/panels/help';
import { numberWord, share } from '../../src/game/words';

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Numbers in text that are not a rule's number, and why. A snippet excuses
 * every hit that falls inside it wherever it is found; `id:` excuses every
 * hit in the one definition.
 */
const NOT_A_RULE: Array<{ at: string; why: string }> = [
];

// ---------------------------------------------------------------------------
// The source, as the compiler reads it. Read off the repository rather than
// off the bundle, which lives in `node_modules/.cache`.
// ---------------------------------------------------------------------------

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
});
const FILES = walk('src').sort();
const SOURCES = FILES.map((f) => ({ file: f, sf: ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true) }));

/** Every fixed piece of text anywhere in the source: string literals and the fixed parts of templates. */
const LITERALS: string[] = [];
for (const { sf } of SOURCES) {
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (node.text.length > 2) LITERALS.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---------------------------------------------------------------------------
// 1. The rules against their text.
// ---------------------------------------------------------------------------

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLACEHOLDER = /\{[\w.]+(?::\w+)?\}/g;

/**
 * Whether the words around a number in a finished text are there as they
 * stand in the source: the number typed out rather than put in. Twelve
 * characters either side, whichever side has any, so a number at the very
 * start of a sentence is still read against what follows it.
 */
function typed(text: string, at: number, token: string): boolean {
  const end = at + token.length;
  const around: string[] = [];
  if (at >= 3) around.push(text.slice(Math.max(0, at - 12), end));
  if (end + 3 <= text.length) around.push(text.slice(at, Math.min(text.length, end + 12)));
  if (!around.length) around.push(text);
  return LITERALS.some((l) => around.some((w) => l.includes(w)));
}

/** The ways a value is written: figures and words, and a share for the parts of a whole. */
function spellings(v: number): string[] {
  if (Number.isInteger(v)) return v >= 2 ? [String(v), numberWord(v)] : [];
  return v > 0 && v < 1 ? [share(v)].filter((s) => !s.endsWith('%') && s !== 'half') : [];
}

let pairs = 0;
/** Hold one text against the fields it talks about. */
function against(what: string, text: string | undefined, fields: Record<string, number | undefined>): void {
  if (!text) return;
  pairs += 1;
  const leftover = text.match(PLACEHOLDER);
  if (leftover) check(`${what}: every placeholder filled`, false, `${leftover.join(' ')} in "${text}"`);
  // Several fields may hold the same number; one line for each place it is typed.
  const found = new Map<number, { token: string; said: string[] }>();
  for (const [field, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    for (const word of spellings(v)) {
      const re = new RegExp(`(?<![\\w-])${escape(word)}(?![\\w-])`, 'gi');
      for (const m of text.matchAll(re)) {
        if (!typed(text, m.index, m[0])) continue;
        const at = found.get(m.index) ?? { token: m[0], said: [] };
        at.said.push(`${field} ${v}`);
        found.set(m.index, at);
      }
    }
  }
  for (const [at, { token, said }] of found) {
    check(`${what} says "${token}" in so many words`, false,
      `${said.join(', ')}: put it in from the rule. "${text.slice(Math.max(0, at - 30), at + token.length + 30)}"`);
  }
}

for (const r of RECIPES) {
  if ((r.count ?? 1) > 1) against(`recipe ${r.id} done`, r.done, { count: r.count });
}

const billOf = (bill: Array<[string, number]>): Record<string, number> =>
  Object.fromEntries(bill.map(([id, n]) => [`bill ${id}`, n]));
for (const f of FURNITURE) {
  const fields = {
    capacity: f.capacity, heft: f.heft, liquid: f.liquid, well: f.well, hive: f.hive, trash: f.trash,
    crates: f.crates, across: f.w, deep: f.h, yokes: f.vehicle?.yokes, needs: f.vehicle?.needs,
    draught: f.boat?.draught, ...billOf(f.bill),
  };
  against(`${f.id} description`, ITEM_DEFS[f.id]?.description, fields);
  against(`${f.id} done`, f.done, fields);
}

for (const [id, d] of Object.entries(ITEM_DEFS)) {
  if (d.holds) against(`${id} description`, d.description, { holds: d.holds, shelter: d.shelter, charges: d.charges });
  else if (d.charges) against(`${id} description`, d.description, { charges: d.charges });
}

for (const m of MOULDS) {
  const fields = { per: m.per, lumps: m.lumps };
  against(`${m.id} description`, ITEM_DEFS[m.id]?.description, fields);
  against(`${m.makes} description`, ITEM_DEFS[m.makes]?.description, fields);
}

for (const c of Object.values(CRATE_DEFS)) against(`${c.item} description`, ITEM_DEFS[c.item]?.description, { capacity: c.capacity });

for (const w of WEAPONS) if (w.range) against(`${w.id} description`, ITEM_DEFS[w.id]?.description, { range: w.range });

check(`${pairs} texts held against their rules`, pairs > 150);

// ---------------------------------------------------------------------------
// 2. The source, read.
// ---------------------------------------------------------------------------

const FIELDS = new Set(['description', 'note', 'lever', 'done', 'fail', 'hint', 'how', 'said']);
const SAYERS = new Set(['logMsg', 'say']);

interface Fragment { text: string; node: ts.Node }

/** The fixed parts of a text: literals, templates, and both sides of a choice or a sum. */
function fragments(node: ts.Expression | undefined, out: Fragment[]): void {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push({ text: node.text, node });
  else if (ts.isTemplateExpression(node)) {
    out.push({ text: node.head.text, node: node.head });
    for (const span of node.templateSpans) {
      fragments(span.expression, out);
      out.push({ text: span.literal.text, node: span.literal });
    }
  } else if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      fragments(node.left, out);
      fragments(node.right, out);
    }
  } else if (ts.isConditionalExpression(node)) {
    fragments(node.whenTrue, out);
    fragments(node.whenFalse, out);
  } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) fragments(node.expression, out);
  else if (ts.isArrayLiteralExpression(node)) for (const e of node.elements) fragments(e as ts.Expression, out);
  else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'join') fragments(node.expression.expression, out);
}

/** The definition a piece of text belongs to: its `id`, or the key it is filed under. */
function idOf(node: ts.Node): string {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'id' && ts.isStringLiteral(p.initializer)) {
          return p.initializer.text;
        }
      }
      if (ts.isPropertyAssignment(n.parent) && (ts.isIdentifier(n.parent.name) || ts.isStringLiteral(n.parent.name))) {
        return n.parent.name.text;
      }
    }
    if (ts.isCallExpression(n) && n.arguments[0] && ts.isStringLiteral(n.arguments[0])
      && ts.isIdentifier(n.expression) && n.expression.text === 'piece') return n.arguments[0].text;
  }
  return '';
}

const blank = (m: string): string => ' '.repeat(m.length);
/** What is not a number in the sense that matters, blanked out so positions still line up. */
const clean = (t: string): string => t
  .replace(/<kbd>[^<]*<\/kbd>/g, blank)
  .replace(/<h\d>[^<]*<\/h\d>/g, blank)
  .replace(/&#?\w+;/g, blank)
  .replace(/<[^>]+>/g, blank)
  .replace(PLACEHOLDER, blank)
  .replace(/\b\d+(?:st|nd|rd|th)\b/g, blank);

const CARDINALS = [
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
  'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'dozen',
];
const MULTIPLIERS = [
  'twice', 'thrice', 'double', 'doubles', 'doubled', 'triple', 'half again', 'half as much again',
  'an? (?:third|quarter|fifth|sixth|seventh|eighth|ninth|tenth|twelfth|twentieth|hundredth)', '\\w+fold',
];
const NUMBER = new RegExp(`\\d+(?:[.,]\\d+)*%?|\\b(?:${[...MULTIPLIERS, ...CARDINALS].join('|')})\\b`, 'gi');

interface Hit { where: string; id: string; token: string; context: string; excused?: string }
const hits: Hit[] = [];
const used = new Set<string>();

function scan(file: string, sf: ts.SourceFile, node: ts.Expression | undefined, field: string): void {
  const out: Fragment[] = [];
  fragments(node, out);
  for (const f of out) {
    const text = clean(f.text);
    for (const m of text.matchAll(NUMBER)) {
      const line = sf.getLineAndCharacterOfPosition(f.node.getStart() + 1 + m.index).line + 1;
      const id = idOf(f.node);
      const hit: Hit = {
        where: `${file}:${line} ${field}`,
        id,
        token: m[0],
        context: text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ').trim(),
      };
      for (const e of NOT_A_RULE) {
        if (e.at.startsWith('id:') ? e.at.slice(3) === id : (() => {
          for (let i = text.indexOf(e.at); i >= 0; i = text.indexOf(e.at, i + 1)) {
            if (i <= m.index && m.index + m[0].length <= i + e.at.length) return true;
          }
          return false;
        })()) {
          hit.excused = e.at;
          used.add(e.at);
          break;
        }
      }
      hits.push(hit);
    }
  }
}

/** The words helpers handed a number typed into the call, which is the same number written out. */
const SPEAKERS = new Set(['numberWord', 'NumberWord', 'share', 'times', 'spanWords', 'percent']);
const literalNumber = (e: ts.Expression): boolean =>
  ts.isNumericLiteral(e) || (ts.isBinaryExpression(e) && literalNumber(e.left) && literalNumber(e.right))
  || (ts.isParenthesizedExpression(e) && literalNumber(e.expression));
const smuggled: string[] = [];

for (const { file, sf } of SOURCES) {
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
      && FIELDS.has(node.name.text)) scan(file, sf, node.initializer, node.name.text);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (SAYERS.has(name)) scan(file, sf, node.arguments[0], name);
      // A piece's `done` is the eighth thing handed to `piece`, and a setting's hint the second to `add`.
      if (name === 'piece' && file.endsWith('furniture.ts')) scan(file, sf, node.arguments[7], 'done');
      if (name === 'add' && file.endsWith('settings.ts')) scan(file, sf, node.arguments[1], 'hint');
      if (SPEAKERS.has(name) && node.arguments[0] && literalNumber(node.arguments[0])) {
        smuggled.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText(sf)}`);
      }
    }
    if (file.endsWith('help.ts') && ts.isFunctionDeclaration(node) && node.name?.text === 'helpText' && node.body) {
      for (const s of node.body.statements) if (ts.isReturnStatement(s)) scan(file, sf, s.expression, 'help');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const loose = hits.filter((h) => !h.excused);
for (const h of loose) console.log(`  ${h.where}${h.id ? ` [${h.id}]` : ''}: "${h.token}" — ${h.context}`);
check(`no number is written out where the rule has it (${hits.length - loose.length} excused)`, loose.length === 0,
  `${loose.length} written out`);
check('no word helper is handed a number typed into the call', smuggled.length === 0, smuggled.join('; '));
const stale = NOT_A_RULE.filter((e) => !used.has(e.at));
check('every excuse still excuses something', stale.length === 0, stale.map((e) => e.at).join('; '));

// ---------------------------------------------------------------------------
// 3. And that what the derivations put together reads.
// ---------------------------------------------------------------------------

const help = helpText();
check('the help renders with nothing undefined in it', !/undefined|NaN|\[object/.test(help),
  help.match(/.{0,40}(?:undefined|NaN|\[object).{0,40}/)?.[0] ?? '');
const left = help.match(PLACEHOLDER);
check('and no placeholder left in it', !left, left?.join(' ') ?? '');

/*
 * What the island reads. The definitions dump carries every item's text into
 * `item_def`, and a placeholder a module never filled would reach every
 * examine line on every island. `{n}` and `{t}` are the spell lines' own and
 * `{food}` a refused taming's, filled by the island when it says them.
 */
const state = readFileSync('supabase/defs-state.sql', 'utf8');
const ISLANDS_OWN = new Set(['{n}', '{t}', '{food}']);
const unfilled = [...state.matchAll(PLACEHOLDER)].map((m) => m[0]).filter((p) => !ISLANDS_OWN.has(p));
check('the definitions the island reads have no placeholder in them', unfilled.length === 0, [...new Set(unfilled)].join(' '));

for (const line of [...ok, ...bad]) console.log(line);
if (bad.length) {
  console.error(`${bad.length} of ${ok.length + bad.length} are not what they should be`);
  process.exit(1);
}
console.log(`the exact benefit — ${ok.length} of ${ok.length}`);
