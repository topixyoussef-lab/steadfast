"use client";

import { useEffect, useRef, useState } from "react";

import type { LinkPreview } from "@/lib/types";

/**
 * The card that turns a pasted link into a title, a description and a picture.
 *
 * Three decisions shape this component.
 *
 * **Nothing is shown until there is something to show.** No skeleton, no
 * placeholder box. The link itself is already rendered as a plain anchor by
 * `LinkifiedText` a line above, so a member always has somewhere to tap; the card
 * is decoration that arrives when it arrives. A shimmer that later grows into a
 * differently-sized card moves the message list under the reader's thumb, which
 * is worse than the card appearing a moment later.
 *
 * **Nothing is shown when the fetch fails**, which is the common case for a link
 * that is dead, behind a login, or refused by our own address checks. A card of
 * just a hostname would be the same link a second time, so the component renders
 * no DOM at all and the message looks like it did before the feature existed.
 *
 * **The fetch waits until the card is near the viewport.** Opening a room can put
 * dozens of links on screen at once, and each one is an outbound request our
 * server makes on the member's behalf. Deferring means reading back through old
 * messages costs nothing until the reader is actually approaching them, and a
 * message they never reach is never fetched.
 *
 * The image goes through `/api/link-preview/image` rather than pointing at its
 * origin, for the reasons written up in that route: the member's browser only
 * ever resolves our hostname, and a link that passed the address checks when the
 * message was written is checked again now.
 */

type PreviewState = {
  loaded: boolean;
  preview: LinkPreview | null;
};

/**
 * In-flight and completed lookups, shared by every card in the room.
 *
 * The same link pasted four times, or the same message rendered again after a
 * Realtime update, is one request rather than four. A null is dropped from the
 * map once it resolves so a later visit can try again -- the server caches its
 * refusals too, so that retry costs a small request to ourselves and not an
 * outbound fetch.
 */
const lookups = new Map<string, Promise<LinkPreview | null>>();

function lookup(url: string): Promise<LinkPreview | null> {
  const existing = lookups.get(url);
  if (existing) return existing;

  const pending = (async (): Promise<LinkPreview | null> => {
    try {
      const response = await fetch(
        `/api/link-preview?url=${encodeURIComponent(url)}`,
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return null;
      return (await response.json()) as LinkPreview;
    } catch {
      // Offline, a dropped connection, a server restarting: none of these are
      // worth surfacing, and the next mount will try again.
      return null;
    }
  })();

  lookups.set(url, pending);
  void pending.then((value) => {
    if (value === null) lookups.delete(url);
  });

  return pending;
}

export function LinkPreviewCard({ url }: { url: string | null }) {
  const [{ loaded, preview }, setState] = useState<PreviewState>({
    loaded: false,
    preview: null,
  });
  const sentinelRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    const load = () => {
      void lookup(url).then((value) => {
        if (cancelled) return;
        setState({ loaded: true, preview: value });
      });
    };

    const node = sentinelRef.current;
    // No observer, or no node to give it: load straight away rather than leave
    // the card permanently blank on an older WebView.
    if (!node || typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      // Read the card a little before it scrolls into view, so it is painted by
      // the time the reader reaches it instead of appearing under their eyes.
      { rootMargin: "300px 0px" },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [url]);

  if (!url) return null;

  if (!loaded) {
    // The card's only job before it loads is to be a marker: this zero-height
    // line is what IntersectionObserver watches, so a link is fetched when the
    // member approaches it and not before. Nothing is painted, so a reader
    // scrolling past a room full of links sees no skeleton flicker.
    return <span ref={sentinelRef} className="block h-0 w-full" aria-hidden />;
  }

  if (!preview) return null;

  const site = preview.siteName;
  const heading = preview.title ?? site;
  const description = preview.description;

  // The rule above the card lives here rather than in the message thread: a card
  // that fails to load renders no DOM, and a divider owned by the parent would
  // be left behind with nothing under it. As written, the line and the card
  // appear and disappear together. It is always safe to draw because a preview
  // only ever exists for a message that has text, and that text is above it.
  return (
    <div className="mt-2 pt-2 border-t border-line/60">
      <a
        href={preview.url}
        target="_blank"
        // Matching the anchor `LinkifiedText` builds: noopener keeps the opened
        // page from holding a handle on this window, and noreferrer stops it
        // learning which room the link came from.
        rel="noopener noreferrer nofollow"
        className="block w-full min-w-0 overflow-hidden rounded-xl border border-line bg-surface text-start transition hover:border-accent/60"
      >
        {preview.imageUrl && <PreviewImage src={preview.imageUrl} />}

        <span className="flex flex-col gap-0.5 p-3">
          {site && (
            <span className="truncate text-[11px] font-medium uppercase tracking-wide text-faint">
              {site}
            </span>
          )}
          {heading && (
            <span className="line-clamp-2 text-sm font-medium text-ink">
              {heading}
            </span>
          )}
          {description && (
            <span className="line-clamp-2 text-xs text-muted">
              {description}
            </span>
          )}
        </span>
      </a>
    </div>
  );
}

/**
 * The og:image, if the page has one worth showing.
 *
 * `alt` is empty because the title sits directly beneath it: a screen reader
 * announcing the same sentence twice is not an improvement, and the text node
 * that follows is the accessible name of the card.
 */
function PreviewImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- the src is our own
       proxy route, not a static asset, so next/image has nothing to optimise
       against and would only add a runtime dependency on the remote host. */
    <img
      src={`/api/link-preview/image?url=${encodeURIComponent(src)}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-32 w-full border-b border-line/60 bg-sunken object-cover"
    />
  );
}
