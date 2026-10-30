/**
 * PR review gate: in PR mode, a pull request merges only when every reviewer it asked has answered and no review
 * thread is left open (INTEGRATION.md L2.7). Nobody knows how long Copilot, another bot or a person takes to comment,
 * so nothing here waits: the script turns the pull request's current state into a commit status (`review-gate`) on its
 * head SHA, and the code host's auto-merge waits on that status like on any required check. A workflow
 * (templates/github/workflows/review-gate.yml) reruns it on every review event and, for bot deadlines, on a schedule.
 *
 *   node pr-review-gate.ts check --pr 42 [--post]     evaluate one pull request; --post writes the commit status
 *   node pr-review-gate.ts sweep [--post]             every open pull request (the scheduled run: bot deadlines)
 *   node pr-review-gate.ts check --pr 42 --input pr.json [--now <iso>]   offline, from a saved GraphQL answer
 *
 * Exit codes without --post: 0 success, 1 failure, 3 pending, 2 usage. With --post the status carries the verdict
 * and the command exits 0 unless posting failed, so the workflow's own check does not duplicate it.
 *
 * Policy, from `swarm.json` → `review.pr` on the checked-out (integration) branch:
 *   - a requested person or team blocks without a deadline: an unanswered human review is a real wait;
 *   - a requested bot (Copilot, any `[bot]`, or a login in `review.pr.bots`) blocks for at most `botTimeoutHours`
 *     (default 2) after it was requested; past that the gate passes and says the bot did not answer, so a bot that is
 *     down never stalls integration;
 *   - any unresolved review thread, outdated or not, fails: each one is closed by a fix or a reply, then resolved;
 *   - a reviewer whose latest review is CHANGES_REQUESTED fails;
 *   - with `requireReviewer` (default true), a pull request that never asked anyone stays pending: no request means
 *     there is nothing to wait for, and a gate that waits for nothing passes without having seen anything.
 *
 * Only `node:` built-ins and the `gh` CLI (present on GitHub-hosted runners, authenticated with GH_TOKEN).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONTEXT = 'review-gate';
const DEFAULT_BOTS = ['copilot-pull-request-reviewer', 'Copilot'];

export interface PrGateConfig {
  /** Hours a requested bot may take before the gate stops waiting for it. */
  botTimeoutHours: number;
  /** A pull request that never requested a reviewer stays pending. */
  requireReviewer: boolean;
  /** Extra logins treated as bots (advisory, with a deadline). */
  bots: string[];
}

export const DEFAULT_CONFIG: PrGateConfig = { botTimeoutHours: 2, requireReviewer: true, bots: [] };

export interface Reviewer {
  login: string;
  bot: boolean;
}

export interface PrState {
  number: number;
  headSha: string;
  isDraft: boolean;
  /** Requests still waiting for an answer, with the time of the latest request for that reviewer. */
  pending: (Reviewer & { requestedAt?: string })[];
  /** How many review requests the pull request has ever had. */
  requestedEver: number;
  reviews: (Reviewer & { state: string })[];
  threads: { resolved: boolean; author: string; path?: string; line?: number; url?: string }[];
  /** True when a list hit the 100-item page: the gate refuses to guess about what it did not read. */
  truncated: boolean;
}

export interface Verdict {
  state: 'success' | 'failure' | 'pending';
  /** One line, at most 140 characters (the commit status limit). */
  description: string;
  details: string[];
}

export function loadPrConfig(cwd: string = process.cwd()): PrGateConfig {
  const file = join(cwd, 'swarm.json');
  if (!existsSync(file)) return DEFAULT_CONFIG;
  let pr: unknown;
  try {
    pr = (JSON.parse(readFileSync(file, 'utf8')) as { review?: { pr?: unknown } }).review?.pr;
  } catch {
    return DEFAULT_CONFIG;
  }
  if (!pr || typeof pr !== 'object') return DEFAULT_CONFIG;
  const p = pr as Record<string, unknown>;
  return {
    botTimeoutHours: typeof p.botTimeoutHours === 'number' && p.botTimeoutHours >= 0 ? p.botTimeoutHours : DEFAULT_CONFIG.botTimeoutHours,
    requireReviewer: typeof p.requireReviewer === 'boolean' ? p.requireReviewer : DEFAULT_CONFIG.requireReviewer,
    bots: Array.isArray(p.bots) && p.bots.every((b) => typeof b === 'string') ? (p.bots as string[]) : DEFAULT_CONFIG.bots,
  };
}

export const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number isDraft headRefOid
      reviewRequests(first: 100) { nodes { requestedReviewer { __typename ...R } } }
      reviews(first: 100) { nodes { state author { __typename login } } }
      reviewThreads(first: 100) { nodes { isResolved path line comments(first: 1) { nodes { url author { login } } } } }
      timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 100) {
        filteredCount
        nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ...R } } }
      }
    }
  }
}
fragment R on RequestedReviewer { ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { slug } }`;

type RawReviewer = { __typename?: string; login?: string; slug?: string } | null | undefined;
type Nodes<T> = { nodes?: T[] } | undefined;

function isBot(r: RawReviewer, login: string, cfg: PrGateConfig): boolean {
  return r?.__typename === 'Bot' || login.endsWith('[bot]') || DEFAULT_BOTS.includes(login) || cfg.bots.includes(login);
}

function reviewer(r: RawReviewer, cfg: PrGateConfig): Reviewer {
  const login = r?.login ?? (r?.slug ? `team:${r.slug}` : 'unknown');
  return { login, bot: isBot(r, login, cfg) };
}

/** The GraphQL answer (`{ data: { repository: { pullRequest } } }` or the pull request itself) as a `PrState`. */
export function fromGraphql(raw: unknown, cfg: PrGateConfig): PrState {
  const root = raw as { data?: { repository?: { pullRequest?: unknown } } };
  const pr = (root?.data?.repository?.pullRequest ?? raw) as {
    number: number; isDraft: boolean; headRefOid: string;
    reviewRequests: Nodes<{ requestedReviewer: RawReviewer }>;
    reviews: Nodes<{ state: string; author: RawReviewer }>;
    reviewThreads: Nodes<{ isResolved: boolean; path?: string; line?: number; comments?: Nodes<{ url?: string; author?: RawReviewer }> }>;
    timelineItems: Nodes<{ createdAt?: string; requestedReviewer?: RawReviewer }> & { filteredCount?: number };
  };
  if (!pr || typeof pr.number !== 'number') throw new Error('no pullRequest in the GraphQL answer');
  const requestedAt = new Map<string, string>();
  for (const e of pr.timelineItems?.nodes ?? []) {
    if (!e?.createdAt) continue;
    const { login } = reviewer(e.requestedReviewer, cfg);
    const prev = requestedAt.get(login);
    if (!prev || e.createdAt > prev) requestedAt.set(login, e.createdAt);
  }
  const requests = pr.reviewRequests?.nodes ?? [];
  const reviews = pr.reviews?.nodes ?? [];
  const threads = pr.reviewThreads?.nodes ?? [];
  return {
    number: pr.number,
    headSha: pr.headRefOid,
    isDraft: pr.isDraft,
    pending: requests.map((n) => {
      const r = reviewer(n.requestedReviewer, cfg);
      return { ...r, requestedAt: requestedAt.get(r.login) };
    }),
    requestedEver: pr.timelineItems?.filteredCount ?? requestedAt.size,
    reviews: reviews.map((n) => ({ ...reviewer(n.author, cfg), state: n.state })),
    threads: threads.map((t) => {
      const first = t.comments?.nodes?.[0];
      return { resolved: t.isResolved, author: first?.author?.login ?? 'unknown', path: t.path, line: t.line ?? undefined, url: first?.url };
    }),
    truncated: [requests, reviews, threads].some((l) => l.length >= 100),
  };
}

function clip(s: string): string {
  return s.length <= 140 ? s : `${s.slice(0, 139)}…`;
}

export function evaluate(pr: PrState, cfg: PrGateConfig, now: Date = new Date()): Verdict {
  const details: string[] = [];
  if (pr.truncated) return { state: 'failure', description: 'more than 100 reviews, requests or threads: check this pull request by hand', details };
  if (pr.isDraft) return { state: 'pending', description: 'draft: mark it ready for review', details };

  const open = pr.threads.filter((t) => !t.resolved);
  for (const t of open) details.push(`open thread by ${t.author}${t.path ? ` at ${t.path}${t.line ? `:${t.line}` : ''}` : ''}${t.url ? ` ${t.url}` : ''}`);

  const latest = new Map<string, string>();
  for (const r of pr.reviews) if (r.state !== 'COMMENTED' && r.state !== 'PENDING') latest.set(r.login, r.state);
  const blocking = [...latest].filter(([, s]) => s === 'CHANGES_REQUESTED').map(([login]) => login);
  for (const login of blocking) details.push(`changes requested by ${login}`);

  const waiting: string[] = [];
  const skipped: string[] = [];
  const limitMs = cfg.botTimeoutHours * 3_600_000;
  for (const r of pr.pending) {
    if (!r.bot) {
      waiting.push(r.login);
      continue;
    }
    const since = r.requestedAt ? Date.parse(r.requestedAt) : Number.NaN;
    // A bot request whose time is unknown gets no deadline: better to wait for a person to look than to pass blind.
    if (Number.isNaN(since) || now.getTime() - since < limitMs) {
      const until = Number.isNaN(since) ? '' : ` until ${new Date(since + limitMs).toISOString().slice(11, 16)}Z`;
      waiting.push(`${r.login}${until}`);
    } else skipped.push(r.login);
  }
  for (const w of waiting) details.push(`waiting for ${w}`);
  for (const s of skipped) details.push(`${s} did not answer within ${cfg.botTimeoutHours}h: not waiting for it`);

  if (open.length || blocking.length) {
    const parts = [open.length ? `${open.length} unresolved review thread(s)` : '', blocking.length ? `changes requested by ${blocking.join(', ')}` : ''];
    return { state: 'failure', description: clip(`${parts.filter(Boolean).join('; ')}: fix or reply, then resolve`), details };
  }
  if (waiting.length) return { state: 'pending', description: clip(`waiting for ${waiting.join(', ')}`), details };
  if (cfg.requireReviewer && pr.requestedEver === 0 && pr.reviews.length === 0) {
    return { state: 'pending', description: 'no reviewer requested: request one (Copilot or a person)', details };
  }
  const note = skipped.length ? ` (${skipped.join(', ')} did not answer within ${cfg.botTimeoutHours}h)` : '';
  return { state: 'success', description: clip(`every requested reviewer answered, no open threads${note}`), details };
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trimEnd();
}

function repository(): { owner: string; name: string } {
  const full = process.env.GITHUB_REPOSITORY || gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const [owner, name] = full.split('/');
  if (!owner || !name) throw new Error(`cannot tell the repository from "${full}"`);
  return { owner, name };
}

function fetchPr(number: number): unknown {
  const { owner, name } = repository();
  return JSON.parse(gh(['api', 'graphql', '-f', `query=${QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-F', `number=${number}`]));
}

function post(pr: PrState, v: Verdict): void {
  const { owner, name } = repository();
  gh(['api', '--method', 'POST', `repos/${owner}/${name}/statuses/${pr.headSha}`, '-f', `state=${v.state}`, '-f', `context=${CONTEXT}`, '-f', `description=${v.description}`]);
}

function report(pr: PrState, v: Verdict, out: (line: string) => void): void {
  const mark = v.state === 'success' ? '✓' : v.state === 'failure' ? '✗' : '…';
  out(`${mark} #${pr.number} ${v.state}: ${v.description}`);
  for (const d of v.details) out(`  - ${d}`);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[], out: (line: string) => void = console.log, cwd: string = process.cwd()): number {
  const [cmd, ...args] = argv;
  const cfg = loadPrConfig(cwd);
  const nowArg = flag(args, '--now');
  const now = nowArg ? new Date(nowArg) : new Date();
  const doPost = args.includes('--post');
  try {
    if (cmd === 'check') {
      const number = Number(flag(args, '--pr'));
      if (!Number.isInteger(number) || number <= 0) throw new Error('check needs --pr <number>');
      const input = flag(args, '--input');
      const pr = fromGraphql(input ? JSON.parse(readFileSync(input, 'utf8')) : fetchPr(number), cfg);
      const v = evaluate(pr, cfg, now);
      report(pr, v, out);
      if (doPost) {
        post(pr, v);
        return 0;
      }
      return v.state === 'success' ? 0 : v.state === 'failure' ? 1 : 3;
    }
    if (cmd === 'sweep') {
      const numbers = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number', '--jq', '[.[].number]'])) as number[];
      for (const n of numbers) {
        const pr = fromGraphql(fetchPr(n), cfg);
        const v = evaluate(pr, cfg, now);
        report(pr, v, out);
        if (doPost) post(pr, v);
      }
      return 0;
    }
    out('usage: pr-review-gate.ts check --pr <n> [--post] [--input <graphql.json>] [--now <iso>] | sweep [--post]');
    return 2;
  } catch (e) {
    out(`✗ pr-review-gate: ${(e as Error).message}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
