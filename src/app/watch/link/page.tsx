import { requireProfile } from "@/lib/dal";
import { getDictionary } from "@/lib/i18n/server";

/**
 * Hand-off page for the device companion.
 *
 * The companion opens this URL in its own WebView. After the member signs in
 * (or straight away if they already are), this page fetches /api/watch/token
 * same-origin and hands the session to the app through its custom scheme.
 */
export default async function WatchLinkPage() {
  const dict = await getDictionary();
  await requireProfile();

  const script = `
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

  return (
    <main className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 px-6">
      <p className="text-sm text-muted">{dict.settings.watchLinkConnecting}</p>
      <p id="watch-link-error" hidden className="text-sm text-danger">
        {dict.settings.watchLinkFailed}
      </p>
      <script
        dangerouslySetInnerHTML={{
          // The companion app is the intended recipient; this is its own host.
          __html: script,
        }}
      />
    </main>
  );
}