package com.steadfast.watch

/**
 * Single place for the endpoints and constants the app talks to.
 *
 * BASE_URL points at the same deployment the APK inside the main app is served
 * from. On an emulator the local dev server is reachable at 10.0.2.2, so a
 * debug build can be pointed there during development without touching the
 * release value.
 */
object Config {
  const val BASE_URL = "https://steadfast-lake-eta.vercel.app"
  const val SCHEME = "steadfast-watch"

  /** Answers allowed queries; a filtering DNS (Cloudflare Family + malware). */
  const val RESOLVER_V4 = "1.1.1.2"

  /** The tunnel only routes DNS, so the rest of the network bypasses it. */
  const val TUN_ADDR = 0x0A000002L.toInt() // 10.0.0.2 (our interface)
  const val TUN_DNS = 0x0A000001L.toInt() // 10.0.0.1 (the pushed DNS server)

  const val PREFS = "watch"
  const val KEY_TOKEN = "token"
  const val KEY_REFRESH = "refresh"
  const val KEY_EXP = "exp"
}