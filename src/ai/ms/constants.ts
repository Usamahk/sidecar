import type { SourceType } from '@/types'

/**
 * Every label set, statement, and threshold used by the milliseconds-backed
 * decisions lives here — one file to review, per the milliseconds skill's
 * "Put the constants in one place" guidance. The wording IS the instruction
 * the model follows; keep statements as third-person claims about the text.
 */

// --- #1  Scan ASSIGN — batched yes-no per item × theme --------------------

/** Minimum per-statement probability to convert a yes answer into an assignment. */
export const MIN_ASSIGN_PROBABILITY = 0.75

/** Items per `texts` request. SDK caps batches at 32 inputs per call. */
export const MS_SCAN_TEXTS_BATCH = 32

/** SDK independently caps statements at 32, regardless of the text count. */
export const MS_SCAN_STATEMENTS_BATCH = 32

/** Build one statement per theme to check membership against the capture. */
export function themeAssignmentStatement(name: string, description: string): string {
  const desc = description.trim()
  return desc
    ? `The capture is about ${name} — ${desc}.`
    : `The capture is about ${name}.`
}

// --- #2  Resolver usable-article gate -------------------------------------

/** Chars sent to the model; the rest of the page is noise for this judgement. */
export const MS_RESOLVER_SAMPLE_CHARS = 2_000

/** Below this many extracted chars, don't even bother asking — it's not an article. */
export const MS_RESOLVER_MIN_CHARS_FOR_CHECK = 200

/** Accept the fetched text as the article only when the yes-no clears this. */
export const MS_RESOLVER_MIN_PROBABILITY = 0.85

/** Legacy gate kept as the fallback when no ms key is set, and as a safety net. */
export const RESOLVER_MIN_USEFUL_CHARS = 600

export const RESOLVER_ARTICLE_STATEMENT =
  'The text contains substantive paragraphs of prose on the article\'s topic, not a paywall, cookie banner, 404, login wall, subscribe prompt, or navigation chrome.'

// --- #3  detectSourceType fallback — classify when hostname rules miss ----

/** Chars of the captured text sampled into the classifier prompt. */
export const MS_SOURCE_TYPE_SAMPLE_CHARS = 400

/**
 * Minimum classify `probability` to trust the winner. Tuned against the live
 * smoke test: the SourceType labels overlap heavily (a Substack issue IS an
 * essay; an essay IS an article), so probability spreads across 2–3 labels and
 * the right answer typically lands in 0.4–0.6. Below this, keep 'website'.
 */
export const MS_SOURCE_TYPE_MIN_PROBABILITY = 0.45

/** Additional gate on `confidence` (1 − normalised entropy) alongside probability. */
export const MS_SOURCE_TYPE_MIN_CONFIDENCE = 0.1

/**
 * Case descriptions for every SourceType. Each label names a discriminating
 * marker (what text it carries, what its purpose is) so the model has something
 * to pivot on when several labels could superficially fit — per the skill's
 * "describe the case, never the verdict" rule.
 */
export const SOURCE_TYPE_LABELS: Readonly<Record<SourceType, string>> = {
  newsletter:
    'a sent newsletter issue addressed to subscribers, with markers such as "this week", "welcome back", "issue #", "if you were forwarded this", or a subscribe-in-your-inbox prompt (Substack, Beehiiv, mailing-list digests)',
  website:
    'an article, essay, or blog post written primarily to inform or persuade a reader, with substantive paragraphs on a single topic and no subscription prompt or product-selling framing',
  twitter:
    'a tweet or thread on X/Twitter: a short reply-chained post with @-handles, likes/retweets, or a quoted-tweet structure',
  reddit:
    'a Reddit submission or comment thread, with markers such as subreddit names (r/…), "OP", upvotes, or threaded replies',
  product:
    'a product landing, pricing, or marketing page that exists primarily to sell or demo a product, with feature grids, pricing tiers, call-to-action buttons, customer logos, or "start free"/"request a demo" language',
  internal:
    'a personal note or draft the user typed themselves, with no author byline, no publication context, no URL or only a local one',
}
