import { requireProfile } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Hand-off page for the Steadfast Watch companions.
 *
 * The device apps open this URL in their own WebView: after the member signs
 * in, this page fetches /api/watch/token same-origin and hands the session to
 * the app through its custom scheme.
 *
 * The browser extension opens it as /watch/link?browser=1: no custom scheme,
 * just a friendly confirmation. The extension picks up the same session
 * itself through the browser cookie.
 */
export default async function WatchLinkPage({
  searchParams,
}: PageProps<"/watch/link">) {
  const [dict, rawParams] = await Promise.all([getDictionary(), searchParams]);
  await requireProfile();

  const browser = rawParams.browser === "1";

  const schemeScript = `
    fetch('/api/watch/token')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.token) throw new Error('no token');
        var url = 'steadfast-watch://auth?token=' + encodeURIComponent(d.token) +
          '&refresh=' + encodeURIComponent(d.refresh || '') +
          '&exp=' + encodeURIComponent(d.expiresAt || '');
        window.location.replace(url);
      })
      .catch(function () {
        document.getElementById('watch-link-error').style.display = 'block';
      });
  `;

  const browserScript = `
    var done = document.getElementById('wlb-done');
    var err = document.getElementById('wlb-error');
    fetch('/api/watch/token')
      .then(function (r) { if (!r.ok) throw new Error('no session'); return r.json(); })
      .then(function (d) {
        if (!d || !d.token) throw new Error('no token');
        done.hidden = false;
      })
      .catch(function () {
        err.hidden = false;
        var next = '/watch/link?browser=1';
        window.location.replace('/login?next=' + encodeURIComponent(next));
      });
  `;

  if (browser) {
    return (
      <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted">{dict.settings.watchLinkConnecting}</p>
        <p id="wlb-done" hidden className="text-sm font-medium">
          {dict.settings.watchLinkBrowserDone}
        </p>
        <p id="wlb-error" hidden className="text-sm text-danger">
          {dict.settings.watchLinkBrowserRetry}
        </p>
        <p className="text-xs text-muted">
          {dict.settings.watchLinkBrowserHint}
        </p>
        <script dangerouslySetInnerHTML={{ __html: browserScript }} />
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 px-6">
      <p className="text-sm text-muted">{dict.settings.watchLinkConnecting}</p>
      <p id="watch-link-error" hidden className="text-sm text-danger">
        {dict.settings.watchLinkFailed}
      </p>
      <script
        dangerouslySetInnerHTML={{
          // The companion app is the intended recipient; this is its own host.
          __html: schemeScript,
        }}
      />
    </main>
  );
}