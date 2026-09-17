/**
 * Bounded replay budget for conversation history.
 *
 * Without a budget, every turn of a long-lived conversation is re-sent to the
 * model verbatim — including attachment text of past turns (up to 2 MB each) —
 * until the request exceeds the provider context window. Providers then either
 * reject the request or silently drop the oldest turns, which reads to the
 * user as "the thread forgot its own context". This module walks history from
 * newest to oldest, keeps recent turns verbatim, middle-abbreviates the next
 * tier of older turns, and explicitly marks what was omitted so the model can
 * say so instead of guessing.
 *
 * Context Budget v2 budgets in estimated tokens instead of raw characters.
 * The estimator intentionally matches usage accounting (≈3 chars/token), so
 * prompt budgeting and cost telemetry use the same unit. The legacy character
 * option/env remains supported for backwards compatibility.
 */

import { estimateTokens } from "./usage-pricing";

export interface HistoryTurn {
  role: "user" | "assistant" | "system";
  content: unknown;
}

export interface HistoryBudgetOptions {
  /** Preferred total token budget for historical turns. */
  maxTokens?: number;
  /** @deprecated Legacy character budget; converted to estimated tokens. */
  maxChars?: number;
  /** Newest turns always kept verbatim (subject only to the global budget). */
  recentFullTurns?: number;
}

export interface HistoryBudgetResult {
  messages: HistoryTurn[];
  /** Turns left out entirely. */
  omittedTurnCount: number;
  /** Turns kept but shortened in the middle. */
  truncatedTurnCount: number;
  /** Estimated tokens consumed by returned historical content (notice excluded). */
  estimatedTokens: number;
  /** Effective historical token budget used for this request. */
  maxTokens: number;
}

/** Legacy default kept for compatibility: 48k chars ≈ 16k estimated tokens. */
export const DEFAULT_HISTORY_CHAR_BUDGET = 48_000;
const MIN_HISTORY_CHAR_BUDGET = 8_000;
const MAX_HISTORY_CHAR_BUDGET = 200_000;

/** Default history budget leaves headroom for system prompts, tools, web, and output. */
export const DEFAULT_HISTORY_TOKEN_BUDGET = 16_000;
const MIN_HISTORY_TOKEN_BUDGET = 2_500;
const MAX_HISTORY_TOKEN_BUDGET = 64_000;
export const DEFAULT_RECENT_FULL_TURNS = 6;
/** Do not keep a truncated turn that carries less text than this. */
const MIN_TRUNCATED_TURN_TOKENS = 100;
/** Images cannot be abbreviated; charge a fixed approximate prompt-token cost. */
const IMAGE_PART_TOKEN_WEIGHT = 267;
const TRUNCATION_MARK = "…（長さ制限のため中略）…";
const SAFETY_MARGIN_TOKENS = 16;
const ESTIMATED_CHARS_PER_TOKEN = 3;

export function resolveHistoryCharBudget(
  raw: string | undefined = process.env.HISTORY_CONTEXT_CHAR_BUDGET,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_HISTORY_CHAR_BUDGET;
  return Math.min(
    MAX_HISTORY_CHAR_BUDGET,
    Math.max(MIN_HISTORY_CHAR_BUDGET, Math.floor(parsed)),
  );
}

export function resolveHistoryTokenBudget(
  raw: string | undefined = process.env.HISTORY_CONTEXT_TOKEN_BUDGET,
  legacyRaw: string | undefined = process.env.HISTORY_CONTEXT_CHAR_BUDGET,
): number {
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) {
    return Math.min(
      MAX_HISTORY_TOKEN_BUDGET,
      Math.max(MIN_HISTORY_TOKEN_BUDGET, Math.floor(parsed)),
    );
  }

  if (legacyRaw !== undefined && legacyRaw.trim() !== "") {
    return Math.min(
      MAX_HISTORY_TOKEN_BUDGET,
      Math.max(
        MIN_HISTORY_TOKEN_BUDGET,
        estimateTokens("x".repeat(resolveHistoryCharBudget(legacyRaw))),
      ),
    );
  }

  return DEFAULT_HISTORY_TOKEN_BUDGET;
}

function isImagePart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "image_url"
  );
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    !!part &&
    typeof part === "object" &&
    (part as { type?: unknown }).type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function measureContentTokens(content: unknown): number {
  if (typeof content === "string") return estimateTokens(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (sum, part) => sum + (isTextPart(part) ? estimateTokens(part.text) : 0),
    content.filter(isImagePart).length * IMAGE_PART_TOKEN_WEIGHT,
  );
}

/** Middle abbreviation: keep the head (topic) and the tail (recent referents). */
export function truncateTextMiddle(text: string, targetChars: number): string {
  if (targetChars <= 0) return "";
  if (text.length <= targetChars) return text;
  const budget = Math.max(0, targetChars - TRUNCATION_MARK.length);
  if (budget <= 0) return TRUNCATION_MARK;
  const headChars = Math.max(1, Math.floor(budget * 0.7));
  const tailChars = Math.max(0, budget - headChars);
  const head = text.slice(0, headChars);
  const tail = tailChars > 0 ? text.slice(-tailChars) : "";
  return `${head}${TRUNCATION_MARK}${tail}`;
}

function truncateContentToTokens(
  content: unknown,
  targetTokens: number,
): unknown {
  if (typeof content === "string") {
    return truncateTextMiddle(
      content,
      Math.max(0, targetTokens * ESTIMATED_CHARS_PER_TOKEN),
    );
  }
  if (!Array.isArray(content)) return content;

  const textTokens = content.reduce(
    (sum, part) => sum + (isTextPart(part) ? estimateTokens(part.text) : 0),
    0,
  );
  const imageCount = content.filter(isImagePart).length;
  const imageTokens = imageCount * IMAGE_PART_TOKEN_WEIGHT;
  const textBudgetTokens = Math.max(0, targetTokens - imageTokens);
  if (textTokens <= textBudgetTokens) return content;

  // Shrink each text part proportionally; images are bounded elsewhere.
  const scale = textTokens > 0 ? textBudgetTokens / textTokens : 0;
  return content.map((part) => {
    if (!isTextPart(part)) return part;
    const targetPartTokens = Math.floor(estimateTokens(part.text) * scale);
    return {
      ...part,
      text: truncateTextMiddle(
        part.text,
        targetPartTokens * ESTIMATED_CHARS_PER_TOKEN,
      ),
    };
  });
}

function resolveEffectiveBudget(options: HistoryBudgetOptions): number {
  if (options.maxTokens !== undefined) {
    return Math.max(1, Math.floor(options.maxTokens));
  }
  if (options.maxChars !== undefined) {
    const boundedChars = Math.min(
      MAX_HISTORY_CHAR_BUDGET,
      Math.max(1, Math.floor(options.maxChars)),
    );
    return Math.max(1, estimateTokens("x".repeat(boundedChars)));
  }
  return resolveHistoryTokenBudget();
}

/**
 * Apply the newest-first replay budget. The returned messages stay in
 * chronological order; when turns were omitted, a leading system note tells
 * the model the history is partial.
 */
export function budgetConversationHistory(
  messages: HistoryTurn[],
  options: HistoryBudgetOptions = {},
): HistoryBudgetResult {
  const maxTokens = resolveEffectiveBudget(options);
  const recentFullTurns = Math.max(
    0,
    Math.floor(options.recentFullTurns ?? DEFAULT_RECENT_FULL_TURNS),
  );

  const measured = messages.map((message) => ({
    message,
    cost: measureContentTokens(message.content),
  }));

  const kept: HistoryTurn[] = [];
  let remaining = maxTokens;
  let omittedTurnCount = 0;
  let truncatedTurnCount = 0;

  for (let index = measured.length - 1; index >= 0; index -= 1) {
    const { message, cost } = measured[index];
    const isRecent = measured.length - 1 - index < recentFullTurns;

    if (cost <= remaining) {
      kept.unshift(message);
      remaining -= cost;
      continue;
    }

    // The turn no longer fits: keep an abbreviated version while the budget
    // can still carry meaningful text, then omit everything older. Recent
    // turns are treated identically here because the global budget is the hard
    // safety boundary; `recentFullTurns` documents the desired full-fidelity
    // tier for future summary strategies.
    void isRecent;
    const keepBudget = remaining - SAFETY_MARGIN_TOKENS;
    if (keepBudget >= MIN_TRUNCATED_TURN_TOKENS) {
      kept.unshift({
        ...message,
        content: truncateContentToTokens(message.content, keepBudget),
      });
      truncatedTurnCount += 1;
      omittedTurnCount += index;
      remaining = 0;
    } else {
      omittedTurnCount += index + 1;
    }
    break;
  }

  const result: HistoryTurn[] = [];
  if (omittedTurnCount > 0) {
    result.push({
      role: "system",
      content:
        `【会話履歴の省略】これより前の会話 ${omittedTurnCount} ターン分はコンテキスト長の制約により省略されています。` +
        `省略された内容について聞かれた場合は、推測で答えずユーザーに要点を確認してください。`,
    });
  }
  result.push(...kept);

  const estimatedTokens = kept.reduce(
    (sum, message) => sum + measureContentTokens(message.content),
    0,
  );

  return {
    messages: result,
    omittedTurnCount,
    truncatedTurnCount,
    estimatedTokens,
    maxTokens,
  };
}
