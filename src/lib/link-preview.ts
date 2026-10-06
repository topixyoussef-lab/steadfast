import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { LinkPreview } from "@/lib/types";

export type { LinkPreview };

/**
 * Link previews.
 *
 * This module's one job is to fetch a URL a member typed into a chat message and
 * read three strings out of its <head>. The reason it is written defensively
 * instead of calling fetch() directly is that the URL is attacker-controlled and
 * the request leaves the browser entirely: without the checks below, a message
 * containing `http://169.254.169.254/latest/meta-data/` makes the application
 * server ask the cloud metadata service about itself, and `http://localhost:5432`
 * pokes every internal service this host can reach.
 *
 * What is enforced, in order:
 *
 *  - only http and https, no credentials in the URL, default ports only;
 *  - the hostname is not a local name, and does not suffix to one;
 *  - every address the hostname resolves to is a public address, and the fetch
 *    is refused if even one of them is not;
 *  - each redirect hop is put through exactly the same checks, so a public host
 *    that answers 302 to http://10.0.0.1/ does not get through;
 *  - the response must be HTML (or an image, for the image proxy), is read at
 *    most HTML_LIMIT bytes, and must answer within HTML_TIMEOUT_MS;
 *  - nothing from the response is ever rendered as markup. The og: values are
 *    entity-decoded, typed as strings, and printed by React as text.
 *
 * Not enforced, and worth stating: fetch() resolves the name again after these
 * checks, so a record that changes between the two (DNS rebinding) is not
 * caught. Closing that needs a custom socket lookup, which Next's fetch does not
 * expose. The blast radius is deliberately small instead -- the response is
 * bounded in size and type, never executed, and only three of its strings are
 * ever returned.
 */

/** Thrown for anything the caller should read as "not a usable link". */
export class BlockedUrlError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BlockedUrlError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** Default ports only. An internal service on :8080 is not our business. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

const MAX_REDIRECTS = 3;
const HTML_LIMIT = 512 * 1024;
const IMAGE_LIMIT = 3 * 1024 * 1024;
const HTML_TIMEOUT_MS = 6000;
const IMAGE_TIMEOUT_MS = 8000;

const USER_AGENT =
  "SteadfastLinkPreview/1.0 (+https://steadfast-lake-eta.vercel.app)";

/**
 * Names that point at this machine, and the suffixes that do. `foo.local` and
 * `metadata.google.internal` are both here because they resolve privately
 * without containing an IP literal for the address check to object to.
 */
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
  "0.0.0.0",
]);
const LOCAL_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".localdomain",
  ".home.arpa",
  ".lan",
];

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, and every cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Expand to the eight 16-bit groups, or null if the address does not parse.
 *
 * Written out rather than reached for as a dependency because the result feeds a
 * security decision: anything this cannot understand has to land on the "blocked"
 * side, and a function that throws makes that harder to see than one that
 * returns null.
 */
function expandIpv6(input: string): number[] | null {
  let ip = input.toLowerCase();

  // An embedded dotted tail (::ffff:192.168.0.1) becomes two hex groups, so the
  // rest of the parser only ever sees hexadecimals.
  const tail = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const octets = tail[1].split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    ip =
      ip.slice(0, ip.length - tail[1].length) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:` +
      ((octets[2] << 8) | octets[3]).toString(16);
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || rest === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    // "::" stands for at least one group of zeros. Zero means the address was
    // already full and the "::" is meaningless, which is a malformed address.
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }

  if (groups.length !== 8) return null;
  return groups;
}

function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (!groups) return true; // unparseable is the same side as private

  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1

  // ::ffff:a.b.c.d and the deprecated ::a.b.c.d both carry a v4 address in the
  // last two groups, and v4 rules apply to it.
  if (
    groups.slice(0, 5).every((g) => g === 0) &&
    (groups[5] === 0xffff || groups[5] === 0)
  ) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateIpv4(v4);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x64 && groups[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64

  return false;
}

function isPrivateAddress(raw: string): boolean {
  const ip = raw.split("%")[0].toLowerCase();
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip);
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not an address at all
}

function assertAddressAllowed(rawAddress: string): void {
  if (isPrivateAddress(rawAddress)) {
    throw new BlockedUrlError(`address ${rawAddress} is not public`);
  }
}

/**
 * Everything that can be decided from the URL itself, plus the DNS check.
 * Throws BlockedUrlError when the address must not be fetched.
 */
async function assertHostAllowed(url: URL): Promise<void> {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError(`protocol ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("credentials in the URL are not allowed");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new BlockedUrlError(`port ${url.port} is not allowed`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "") throw new BlockedUrlError("no host");
  if (LOCAL_HOSTNAMES.has(host)) throw new BlockedUrlError("local host");
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new BlockedUrlError("local host");
  }

  // An IP literal needs no DNS. `isIP` returning 0 for anything else is what
  // sends the normal case on to the resolver.
  if (isIP(host)) {
    assertAddressAllowed(host);
    return;
  }

  let addresses: string[];
  try {
    // `all: true` is what makes this an array rather than a single answer, and
    // is why the result is mapped to its addresses here instead of typed as one
    // -- node's overloads are picked from the arguments, so writing the return
    // type first would have selected the single-answer signature.
    addresses = (await lookup(host, { all: true, verbatim: true })).map(
      (entry) => entry.address,
    );
  } catch {
    throw new BlockedUrlError(`cannot resolve ${host}`);
  }
  if (addresses.length === 0) throw new BlockedUrlError(`cannot resolve ${host}`);

  // Refused if ANY answer is private, because fetch() is free to pick either.
  for (const address of addresses) assertAddressAllowed(address);
}

/**
 * Parse a URL from user input far enough to make a request.
 *
 * `new URL` throws on anything malformed, which is the right answer: a string
 * that will not parse is not a link.
 */
export function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("not a URL");
  }
  if (url.href.length > 2048) throw new BlockedUrlError("URL is too long");
  return url;
}

/**
 * Fetch with redirects followed by hand.
 *
 * `redirect: "manual"` is the whole point: letting fetch follow them silently
 * would skip assertHostAllowed() on every hop after the first, which is exactly
 * the move a link to a cooperating host would use.
 */
async function fetchFollowingRedirects(
  url: URL,
  signal: AbortSignal,
  accept: string,
): Promise<{ response: Response; url: URL }> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertHostAllowed(current);

    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": USER_AGENT,
        accept,
        // Nothing about Steadfast travels with the request, so the far end
        // learns only that some server asked for its page.
        referer: "",
      },
    });

    const location = response.headers.get("location");
    const isRedirect =
      response.status >= 300 && response.status < 400 && location !== null;

    if (!isRedirect) return { response, url: current };

    await response.body?.cancel().catch(() => undefined);
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      throw new BlockedUrlError("redirect target is not a URL");
    }
    current = next;
  }

  throw new BlockedUrlError(`more than ${MAX_REDIRECTS} redirects`);
}

/**
 * Read at most `limit` bytes and hand back what arrived.
 *
 * HTML is truncated rather than rejected because a page's <head> comes first:
 * stopping at 512 KB still leaves every og: tag, and cancelling the stream
 * avoids pulling megabytes down to look at the first four hundred of them.
 */
async function readAtMost(
  response: Response,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), truncated: false };

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const room = limit - total;
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        total = limit;
        await reader.cancel().catch(() => undefined);
        return { bytes: concat(chunks, total), truncated: true };
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    // releaseLock() is synchronous and returns void, unlike cancel(). It throws
    // when a read is still pending, which is possible if the stream aborted
    // mid-chunk, and that is not a reason to fail the whole preview.
    try {
      reader.releaseLock();
    } catch {
      /* the stream is being torn down anyway */
    }
  }

  return { bytes: concat(chunks, total), truncated: false };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Decode using the response's own charset, so a latin-1 page is not mojibake. */
async function decodeWithCharset(
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const response = new Response(bytes.slice(), {
    headers: { "content-type": contentType },
  });
  return response.text();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/**
 * Enough entity decoding to read a title, and no more.
 *
 * `&amp;` is deliberately last: decoding it first turns a page's own `&amp;lt;`
 * into `&lt;` and then into `<`, which is how entity decoders get talked into
 * producing markup this component would then have to be careful about. Nothing
 * here is ever rendered as HTML anyway, so the only cost of a missed entity is a
 * stray ampersand in a preview.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (whole, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .replace(/&#(\d+);/g, (whole, dec: string) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const value = NAMED_ENTITIES[name.toLowerCase()];
      return value ?? whole;
    })
    .replace(/&amp;/g, "&");
}

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(tag)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    out.set(match[1].toLowerCase(), value);
  }
  return out;
}

/**
 * Pull the tags that describe a page, keyed by their lowercased name/property.
 *
 * Regex over raw HTML rather than a parser, because the project has no
 * dependencies and the tags being looked for are flat and early in the document.
 * The output is only ever compared against known keys and printed as text, so a
 * hostile document can at worst put a hostile string in the preview -- which is
 * the same thing it could do by naming its own title.
 */
function readMeta(html: string): Map<string, string> {
  const found = new Map<string, string>();

  META_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = META_TAG.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content");
    if (!key || !content || found.has(key)) continue;
    found.set(key, decodeEntities(content));
  }

  return found;
}

function readTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/i.exec(html);
  if (!match) return null;
  const text = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  return text || null;
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function clamp(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/**
 * Resolve an og:image against the page it came from and refuse anything that is
 * not a plain web address. Relative paths are common and legitimate; a
 * `javascript:` value in an og:image is not something to hand to an <img>.
 */
function resolveImageUrl(raw: string | null, base: URL): string | null {
  if (!raw) return null;
  let resolved: URL;
  try {
    resolved = new URL(raw, base);
  } catch {
    return null;
  }
  if (!ALLOWED_PROTOCOLS.has(resolved.protocol)) return null;
  if (!ALLOWED_PORTS.has(resolved.port)) return null;
  return resolved.toString();
}

/**
 * A bounded, shared cache keyed by the address the member typed.
 *
 * Two reasons, both about not being a proxy for whoever wants one: the same link
 * pasted into a busy room is fetched once rather than once per reader, and a
 * host that cannot be reached is remembered as unreachable instead of being
 * retried on every render. Negative entries are cached for the same length of
 * time as positive ones.
 */
type CacheEntry = { value: LinkPreview | null; expires: number };
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // Re-insert so Map order keeps the most recently used keys last.
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key: string, value: LinkPreview | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Read the preview for a URL, or null when it has nothing worth showing.
 *
 * Null is a real answer and is cached: a link that 404s should not be retried by
 * every member opening the room.
 */
export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  const cached = cacheGet(raw);
  if (cached) return cached.value;

  let preview: LinkPreview | null = null;
  try {
    preview = await unfurl(parseHttpUrl(raw));
  } catch (error) {
    // A blocked address, a timeout, a malformed page: all the same to the card,
    // which simply does not render. The log is for noticing a pattern, not for
    // reporting to the member.
    if (!(error instanceof BlockedUrlError) && !(error instanceof Error)) {
      throw error;
    }
    preview = null;
  }

  cacheSet(raw, preview);
  return preview;
}

async function unfurl(url: URL): Promise<LinkPreview | null> {
  const signal = AbortSignal.timeout(HTML_TIMEOUT_MS);
  const { response, url: finalUrl } = await fetchFollowingRedirects(
    url,
    signal,
    "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  );

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    // A PDF, an image, a JSON API: none of them describe themselves in a way a
    // preview card can use, and pulling them down would only be to discard them.
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const { bytes } = await readAtMost(response, HTML_LIMIT);
  const html = await decodeWithCharset(bytes, contentType);
  const meta = readMeta(html);

  const title = firstNonEmpty(
    meta.get("og:title"),
    meta.get("twitter:title"),
    readTitle(html),
  );
  const description = firstNonEmpty(
    meta.get("og:description"),
    meta.get("twitter:description"),
    meta.get("description"),
  );
  const siteName = firstNonEmpty(
    meta.get("og:site_name"),
    meta.get("application-name"),
    finalUrl.hostname.replace(/^www\./, ""),
  );
  const imageUrl = resolveImageUrl(
    firstNonEmpty(meta.get("og:image"), meta.get("og:image:url"), meta.get("twitter:image")),
    finalUrl,
  );

  // A page that declares neither a title nor a description has nothing to show,
  // and a card of just a hostname is the link the member already sees in the
  // text above it.
  if (!title && !description) return null;

  return {
    url: finalUrl.toString(),
    title: title ? clamp(title, 200) : null,
    description: description ? clamp(description, 400) : null,
    siteName: siteName ? clamp(siteName, 120) : null,
    imageUrl,
  };
}

/**
 * Fetch an image for the preview card through the same guards as the page.
 *
 * Used instead of pointing <img> at the third-party URL directly: it keeps the
 * request on an https page when the image is on http, it stops the member's
 * browser from being the thing that resolves an attacker's hostname, and it
 * means a URL that passed the checks yesterday is re-checked now rather than
 * trusted forever.
 */
export async function fetchPreviewImage(
  raw: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const url = parseHttpUrl(raw);
    const signal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
    const { response } = await fetchFollowingRedirects(url, signal, "image/*");

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/^image\//i.test(contentType.trim())) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const { bytes, truncated } = await readAtMost(response, IMAGE_LIMIT);
    if (truncated || bytes.byteLength === 0) return null;

    return { bytes, contentType: contentType.split(";")[0].trim().toLowerCase() };
  } catch {
    return null;
  }
}
