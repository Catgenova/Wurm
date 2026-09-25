/**
 * What goes wrong in a browser, and what the island keeps of it.
 *
 * The browser half: which errors are worth sending, each once a session and no
 * more than `REPORTS_A_SESSION` of them, and the ones from before the island
 * was joined sent when it is. The island half: `rpc_report_error` writes a
 * report down, cut to length, twenty an hour from one account, and nobody can
 * read the table back through the API.
 */
import { execFileSync } from 'node:child_process';
import { forgetReports, queueReport, reportErrorsTo, REPORTS_A_SESSION, worthReporting, type ErrorReport } from '../../src/net/errors';

const WHO = '44444444-4444-4444-4444-444444444444';

const psql = (sql: string, as = WHO): string =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-f', '-'], {
    env: {
      ...process.env,
      PGHOST: process.env.PGHOST ?? '/var/run/postgresql',
      PGPORT: process.env.PGPORT ?? '5433',
      PGUSER: process.env.PGUSER ?? 'wurm',
      PGDATABASE: process.env.PGDATABASE ?? 'postgres',
    },
    input: `select set_config('request.jwt.claims', '{"sub":"${as}"}', false) \\g /dev/null\n${sql}\n`,
    encoding: 'utf8',
  }).trim();

const ok: string[] = [];
const bad: string[] = [];
const check = (what: string, passed: boolean, detail = ''): void => {
  (passed ? ok : bad).push(`${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? ` — ${detail}` : ''}`);
};

/* ---- The browser ---------------------------------------------------------- */
console.log('--- the browser');

check('an error of ours is worth sending', worthReporting('x is not a function', 'https://example.org/assets/main.js'));
check('an extension\'s is not', !worthReporting('boom', 'chrome-extension://abc/content.js')
  && !worthReporting('boom', 'moz-extension://abc/content.js'));
check('nor a script error that says nothing', !worthReporting('Script error.'));
check('nor the resize observer\'s complaint', !worthReporting('ResizeObserver loop completed with undelivered notifications.'));

forgetReports();
const got: ErrorReport[] = [];
queueReport('before the island', 'stack', 'main.js:1:2');
queueReport('before the island', 'stack', 'main.js:1:2');
check('what goes wrong before the island is joined waits for it', got.length === 0);
reportErrorsTo((r) => got.push(r));
check('and is sent when it is, once', got.length === 1 && got[0].message === 'before the island'
  && got[0].place === 'main.js:1:2' && got[0].build === 'dev', JSON.stringify(got));
for (let i = 0; i < REPORTS_A_SESSION * 3; i++) queueReport(`error ${i}`);
check(`no more than ${REPORTS_A_SESSION} distinct errors a session`, got.length === REPORTS_A_SESSION, `${got.length} sent`);
forgetReports();

/* ---- The island ----------------------------------------------------------- */
console.log('--- the island');

psql(`delete from client_error where uid = '${WHO}'`);
psql(`select rpc_report_error('v600', 'x is not a function', 'at f (main.js:1:2)', 'main.js:1:2', null)`);
const row = psql(`select build || '|' || message || '|' || place from client_error where uid = '${WHO}'`);
check('a report is written down with its build and where it was thrown', row === 'v600|x is not a function|main.js:1:2', row);

psql(`select rpc_report_error('v600', repeat('m', 5000), repeat('s', 50000), repeat('p', 5000))`);
const lengths = psql(`select length(message) || ',' || length(stack) || ',' || length(place)
                        from client_error where uid = '${WHO}' order by id desc limit 1`);
check('and cut to length', lengths === '500,4000,300', lengths);

psql(`select rpc_report_error('v600', '')`);
const empty = psql(`select count(*) from client_error where uid = '${WHO}' and message = ''`);
check('an empty report is not written', empty === '0', empty);

for (let i = 0; i < 30; i++) psql(`select rpc_report_error('v600', 'again ${i}')`);
const heard = Number(psql(`select count(*) from client_error where uid = '${WHO}' and at > now() - interval '1 hour'`));
check('one account is heard twenty times an hour and no more', heard === 20, `${heard} kept`);

const read = psql(`set role authenticated; select count(*) from client_error; reset role;`);
check('nobody reads the reports back through the API', read === '0', `${read} rows visible`);
const anon = psql(`select has_function_privilege('anon', 'public.rpc_report_error(text,text,text,text,uuid)', 'execute')`);
check('and only somebody signed in can write one', anon === 'f', anon);

psql(`delete from client_error where uid = '${WHO}'`);

for (const line of [...ok, ...bad]) console.log(`  ${line}`);
console.log(bad.length ? `\n${bad.length} of ${ok.length + bad.length} went wrong` : `\nwhat goes wrong — ${ok.length} of ${ok.length}`);
process.exit(bad.length ? 1 : 0);
