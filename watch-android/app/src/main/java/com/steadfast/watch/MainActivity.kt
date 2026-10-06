package com.steadfast.watch

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

  private lateinit var statusText: TextView
  private lateinit var linkText: TextView
  private lateinit var countsText: TextView
  private lateinit var detailsText: TextView

  private val vpnResult =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      if (result.resultCode == RESULT_OK) startProtection()
    }

  private val notificationsPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

  private val prefs by lazy {
    getSharedPreferences(Config.PREFS, MODE_PRIVATE)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_main)

    statusText = findViewById(R.id.statusText)
    linkText = findViewById(R.id.linkText)
    countsText = findViewById(R.id.countsText)
    detailsText = findViewById(R.id.detailsText)

    findViewById<Button>(R.id.btnLink).setOnClickListener { openLinkDialog() }
    findViewById<Button>(R.id.btnStart).setOnClickListener { prepareAndStart() }
    findViewById<Button>(R.id.btnStop).setOnClickListener {
      stopService(Intent(this, WatchVpnService::class.java))
      refresh()
    }
    findViewById<Button>(R.id.btnLog).setOnClickListener { shareLog() }

    if (Build.VERSION.SDK_INT >= 33 &&
      checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      notificationsPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val url = intent.dataString
    if (url != null && url.startsWith("${Config.SCHEME}://")) handleScheme(url)
  }

  override fun onResume() {
    super.onResume()
    refresh()
  }

  private fun refresh() {
    val linked = prefs.contains(Config.KEY_TOKEN)
    linkText.text = getString(if (linked) R.string.linked_yes else R.string.linked_no)

    val (blocked, allowed) = Reporter.counters()
    countsText.text = getString(R.string.counts, blocked, allowed)

    val running = WatchVpnService.active
    statusText.text = getString(if (running) R.string.status_active else R.string.status_off)

    val lastDomain = WatchVpnService.lastDomain ?: getString(R.string.details_none)
    val post = when (Reporter.lastCode) {
      "ok" -> getString(R.string.post_ok)
      "refused" -> getString(R.string.post_refused)
      "retry" -> getString(R.string.post_retry)
      else -> getString(R.string.post_pending)
    }

    var details = getString(R.string.details_last, lastDomain) +
      "\n" + getString(R.string.details_packets, WatchVpnService.packetsSeen) +
      "\n" + getString(R.string.details_post, post)

    if (!running && WatchVpnService.packetsSeen == 0L) {
      details += "\n" + getString(R.string.details_hint)
    }

    privateDnsServer()?.let { server ->
      details += "\n" + getString(R.string.private_dns_warning, server)
    }

    detailsText.text = details
  }

  /** Share <filesDir>/watch.log + screen state as plain text. */
  private fun shareLog() {
    val header =
      "linked=${prefs.contains(Config.KEY_TOKEN)}\n" +
        "active=${WatchVpnService.active}\n" +
        "packets=${WatchVpnService.packetsSeen}\n" +
        "parsed=${WatchVpnService.parsedSeen}\n" +
        "lastDomain=${WatchVpnService.lastDomain}\n" +
        "lastSend=${Reporter.lastCode}\n---\n"
    val send = Intent(Intent.ACTION_SEND).apply {
      type = "text/plain"
      putExtra(Intent.EXTRA_TEXT, header + WatchVpnService.logText(this@MainActivity))
    }
    startActivity(Intent.createChooser(send, getString(R.string.btn_log)))
  }

  /**
   * Android Private DNS (DoT) routes DNS straight to a TLS server, ignoring
   * the DNS server the tunnel pushed. Non-null here means capture cannot see
   * ordinary browsing until the user switches it to Off / Automatic.
   */
  private fun privateDnsServer(): String? {
    if (Build.VERSION.SDK_INT < 29) return null
    val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val lp = cm.activeNetwork?.let { cm.getLinkProperties(it) } ?: return null
    return lp.privateDnsServerName?.takeIf { it.isNotBlank() }
  }

  private fun prepareAndStart() {
    val intent = VpnService.prepare(this)
    if (intent != null) vpnResult.launch(intent) else startProtection()
  }

  private fun startProtection() {
    WatchVpnService.start(this)
    refresh()
  }

  /**
   * Link the account: a WebView at /watch/link drives the login then hands the
   * session back through the steadfast-watch:// scheme. The token lives only
   * in this app's private prefs.
   */
  private fun openLinkDialog() {
    val webView = WebView(this)
    webView.settings.javaScriptEnabled = true
    webView.settings.domStorageEnabled = true
    webView.webChromeClient = WebChromeClient()
    webView.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
      ): Boolean {
        val url = request.url.toString()
        if (url.startsWith("${Config.SCHEME}://")) {
          handleScheme(url)
          dialogRef?.dismiss()
          return true
        }
        return false
      }
    }

    val dialog = AlertDialog.Builder(this)
      .setView(webView)
      .setNegativeButton(android.R.string.cancel, null)
      .show()
    dialogRef = dialog
    webView.loadUrl("${Config.BASE_URL}/watch/link")
  }

  /** Reads token/refresh/exp out of the deep link and remembers it. */
  private fun handleScheme(url: String) {
    val uri = Uri.parse(url)
    val token = uri.getQueryParameter("token") ?: return
    prefs.edit()
      .putString(Config.KEY_TOKEN, token)
      .putString(
        Config.KEY_REFRESH,
        uri.getQueryParameter("refresh") ?: "",
      )
      .putLong(Config.KEY_EXP, uri.getQueryParameter("exp")?.toLongOrNull() ?: 0L)
      .apply()
    refresh()
  }

  private var dialogRef: AlertDialog? = null

  override fun onDestroy() {
    super.onDestroy()
    dialogRef?.dismiss()
  }
}