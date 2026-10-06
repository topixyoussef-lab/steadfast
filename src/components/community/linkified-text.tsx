/**
 * Message text with working links.
 *
 * The rule this component exists to keep: **user text never becomes markup.**
 * Every piece of message content is rendered as a React child, so a member
 * typing `<script>` sees the characters and not a tag. The only markup this
 * file produces is the <a> it builds itself, around a URL it has parsed and
 * checked.
 *
 * That check is not a formality. Without it, `javascript:alert(1)` in a
 * message becomes a link a member can tap, and `data:text/html,...` becomes one
 * that runs in this origin. So the scheme is not "anything that looks like a
 * link" -- only http and https produce an anchor, and anything else is left as
 * the plain text it already was.
 *
 * `dangerouslySetInnerHTML` appears nowhere in the chat renderer for the same
 * reason.
 */

import { Fragment } from "react";

import { cn } from "@/lib/cn";

/**
 * Matches bare URLs and keeps the trailing punctuation out of them, because
 * "good job https://example.com." should not link the full stop.
 *
 * Deliberately conservative: it does not try to catch a URL inside an
 * obfuscated form, a mention, or a mailto. An unrecognised address stays as
 * text, which is a smaller win than linkification and a much smaller risk.
 */
const URL_PATTERN =
  /\bhttps?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/gi;

/** Protocols allowed to become clickable. Nothing else is a link. */
const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    return url.toString();
  } catch {
    // A string that starts with http:// but will not parse is not a link.
    return null;
  }
}

type Segment = { kind: "text" | "link"; value: string; href?: string };

function split(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  // `matchAll` on a /g regex does not carry lastIndex between calls, but a
  // fresh exec loop is clearer about the cursor it maintains.
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const href = safeHref(raw);
    if (!href) continue;

    if (match.index > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "link", value: raw, href });
    cursor = match.index + raw.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }

  // Text with nothing in it, or a string of only rejected schemes, renders as
  // one text segment rather than an empty array.
  return segments.length > 0 ? segments : [{ kind: "text", value: text }];
}

/**
 * The first address in a message that would become a link here, or null.
 *
 * The preview card and the anchor must agree on what counts as a link, so both
 * go through this: a message with a `javascript:` scheme in it gets no card for
 * the same reason it gets no <a>.
 */
export function firstUrl(text: string): string | null {
  if (!text) return null;
  URL_PATTERN.lastIndex = 0;
  const match = URL_PATTERN.exec(text);
  if (!match) return null;
  return safeHref(match[0]);
}

export function LinkifiedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  if (!text) return null;

  const segments = split(text);

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {segments.map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={`${segment.href}-${index}`}
            href={segment.href}
            target="_blank"
            // noopener is the one that matters: without it the opened page gets
            // a handle on this window through window.opener. noreferrer also
            // stops the target learning which room the member came from.
            rel="noopener noreferrer nofollow"
            className="font-medium text-accent underline decoration-accent/40 underline-offset-2 transition hover:decoration-accent"
          >
            {segment.value}
          </a>
        ) : (
          <Fragment key={`t-${index}`}>{segment.value}</Fragment>
        ),
      )}
    </span>
  );
}

/**
 * One-line version for previews: the reply quote, the notification body, a log
 * row. Links are pointless in a truncated string, so this returns text with the
 * addresses removed rather than markup nobody can tap.
 */
export function stripUrls(text: string): string {
  return text.replace(URL_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

export function excerpt(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export function messagePreview(text: string, max = 90): string {
  const stripped = stripUrls(text);
  return excerpt(stripped || "…", max);
}
