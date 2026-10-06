package com.steadfast.watch

import android.content.Context
import android.content.SharedPreferences
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Batches domain events and posts them to /api/watch with the member's own
 * session token. The server owns the policy: without an active consent there
 * is nothing to write, so a stale app or an expired token simply degrades to
 * "nothing happens" rather than leaking.
 */
object Reporter {
  private val queue = ConcurrentLinkedQueue<String>()
  private val running = AtomicBoolean(false)
  private val allowed = AtomicInteger(0)
  private val blocked = AtomicInteger(0)

  private var prefs: SharedPreferences? = null

  fun start(context: Context) {
    prefs = context.applicationContext.getSharedPreferences(Config.PREFS, Context.MODE_PRIVATE)
    if (!running.compareAndSet(false, true)) return
    Thread({ loop() }, "watch-reporter").apply {
      isDaemon = true
      start()
    }
  }

  fun stop() {
    running.set(false)
    queue.clear()
  }

  fun counters(): Pair<Int, Int> = blocked.get() to allowed.get()

  fun event(domain: String, isBlocked: Boolean) {
    if (isBlocked) blocked.incrementAndGet() else allowed.incrementAndGet()
    val json = "{\"domain\":\"" + escape(domain) + "\",\"blocked\":" + isBlocked + "}"
    queue.add(json)
    while (queue.size > 500) queue.poll()
  }

  private fun loop() {
    while (running.get()) {
      flush()
      try {
        Thread.sleep(15_000)
      } catch (_: InterruptedException) {
        break
      }
    }
  }

  @Synchronized
  private fun flush() {
    val token = prefs?.getString(Config.KEY_TOKEN, null) ?: return
    val batch = ArrayList<String>(queue.size)
    while (true) {
      val item = queue.poll() ?: break
      batch.add(item)
    }
    if (batch.isEmpty()) return

    val body = "{\"events\":[" + batch.joinToString(",") + "]}"
    when (post(token, body)) {
      POST_OK -> Unit
      POST_STOP -> {
        // Consent revoked or session gone: drop the batch and stop reporting.
        prefs?.edit()?.remove(Config.KEY_TOKEN)?.apply()
      }
      POST_RETRY -> queue.addAll(batch) // transient network error: keep the batch
    }
  }

  private fun post(token: String, body: String): Int {
    return try {
      val conn = URL(Config.BASE_URL + "/api/watch").openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("Authorization", "Bearer $token")
        conn.connectTimeout = 8_000
        conn.readTimeout = 8_000
        conn.doOutput = true
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        when (code) {
          200, 201, 202 -> POST_OK
          401, 403 -> POST_STOP
          else -> POST_RETRY
        }
      } finally {
        conn.disconnect()
      }
    } catch (_: Exception) {
      POST_RETRY
    }
  }

  private fun escape(value: String): String = value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
    .replace("\n", "\\n")

  private const val POST_OK = 0
  private const val POST_STOP = 1
  private const val POST_RETRY = 2
}