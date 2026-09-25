/**
 * What goes wrong in a player's browser, written down on the island.
 *
 * An error nothing caught went to the console of the one browser it happened
 * in, where nobody was looking, and the first anybody heard of it was a player
 * saying something had stopped working -- if they said anything. Each distinct
 * one now goes to the island, once a session, with the build it happened in,
 * and the deploy's readout lists what came in over the last day.
 *
 * Only on an island: the game you play by yourself has nobody to tell. What
 * goes wrong before the island is joined waits for it, up to `REPORTS_A_SESSION`.
 */
import { VERSION } from '../version';

/** Distinct errors one session will send. A loop that throws every frame is one error, not sixty a second. */
export const REPORTS_A_SESSION = 10;

export interface ErrorReport {
  message: string;
  stack?: string;
  /** Where it was thrown, as file:line:column, when the browser says. */
  place?: string;
  build: string;
}

type Send = (r: ErrorReport) => void;

let send: Send | null = null;
const waiting: ErrorReport[] = [];
const sent = new Set<string>();

/**
 * Whether an error is ours to report.
 *
 * Not an extension's, which throws in our page and is nothing we can mend; not
 * "Script error." with nothing after it, which is all a browser will say about
 * a script from another origin; and not the resize observer's complaint that a
 * layout took two passes, which is a warning dressed as an error in every
 * browser that has one.
 */
export function worthReporting(message: string, file = ''): boolean {
  if (!message) return false;
  if (/^(chrome|moz|safari)(-web)?-extension:/.test(file)) return false;
  if (message === 'Script error.' && !file) return false;
  if (message.startsWith('ResizeObserver loop')) return false;
  return true;
}

/** Once a session each, and no more than `REPORTS_A_SESSION` of them. */
export function queueReport(message: string, stack?: string, place?: string): void {
  const key = `${message}\n${place ?? ''}`;
  if (sent.has(key) || sent.size >= REPORTS_A_SESSION) return;
  sent.add(key);
  const report: ErrorReport = { message, build: VERSION };
  if (stack) report.stack = stack;
  if (place) report.place = place;
  if (send) send(report);
  else waiting.push(report);
}

/** Starts listening, once, as the page loads. */
export function watchErrors(): void {
  window.addEventListener('error', (ev: ErrorEvent) => {
    const message = ev.message || String(ev.error ?? '');
    if (!worthReporting(message, ev.filename)) return;
    const place = ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined;
    queueReport(message, (ev.error as Error | undefined)?.stack, place);
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason = ev.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason);
    if (!worthReporting(message)) return;
    queueReport(message, reason instanceof Error ? reason.stack : undefined);
  });
}

/** Where reports go from now on, with whatever went wrong before there was anywhere to send them. */
export function reportErrorsTo(to: Send): void {
  send = to;
  for (const r of waiting.splice(0)) to(r);
}

/** For the tests: forget what this session has sent. */
export function forgetReports(): void {
  send = null;
  waiting.length = 0;
  sent.clear();
}
