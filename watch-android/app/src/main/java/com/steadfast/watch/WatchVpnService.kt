package com.steadfast.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.Executors

/**
 * The agreement's enforcement point: a local VPN whose only routed route is
 * the DNS server it pushes. Every app's DNS queries go through the tunnel;
 * every other byte of traffic bypasses it untouched, so:
 *
 *  - We see (and report) the domains the device actually resolves.
 *  - Blocked domains get no answer at all.
 *  - Nothing else can be sniffed or slowed down by the tunnel itself.
 *
 * Honest limits, reflected in the consent copy: an app with its own hard-coded
 * DoH resolver is outside this net, and Android itself can still resolve while
 * "secure DNS" is enabled — the strong form needs a full tunnel, phase 2.
 */
class WatchVpnService : VpnService() {

  private var tunFd: ParcelFileDescriptor? = null
  private var reader: Thread? = null
  private var writer: FileOutputStream? = null
  private val writeLock = Object()
  private val resolvers = Executors.newFixedThreadPool(4)

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return try {
      start0(intent, flags, startId)
    } catch (e: Exception) {
      // A security/foreground turndown (e.g. another VPN already owns the
      // stack): fail visibly instead of crashing the process.
      logLine("start failed: ${e.message ?: e.toString()}")
      stopSelf()
      START_NOT_STICKY
    }
  }

  private fun start0(intent: Intent?, flags: Int, startId: Int): Int {
    ServiceCompat.startForeground(
      this,
      NOTIFICATION_ID,
      buildNotification(),
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_VPN else 0,
    )

    val builder = Builder()
      .setSession(getString(R.string.vpn_session))
      .setMtu(1400)
      .addAddress(Packets.ipString(Config.TUN_ADDR), 32)
      .addRoute(Packets.ipString(Config.TUN_DNS), 32)
      .addDnsServer(Packets.ipString(Config.TUN_DNS))
      .addDisallowedApplication(packageName)
      .setBlocking(true)

    val fd = builder.establish()
    if (fd == null) {
      // The OS refuses (e.g. another VPN is active): surface WHY so it is not
      // mistaken for a working tunnel.
      logLine("establish() = null -> another VPN active or permission missing?")
      stopSelf()
      return START_NOT_STICKY
    }

    tunFd = fd
    writer = FileOutputStream(fd.fileDescriptor)
    packetsSeen = 0
    parsedSeen = 0
    lastDomain = null
    active = true
    logLine("tunnel established (packets will count from 0)")
    Reporter.start(this)

    reader = Thread({
      try {
        readLoop(FileInputStream(fd.fileDescriptor))
      } finally {
        closeTun()
      }
    }, "watch-dns").apply { start() }

    return START_STICKY
  }

  private fun readLoop(input: FileInputStream) {
    val buf = ByteArray(4096)
    var errors = 0
    while (true) {
      val n = try {
        input.read(buf)
      } catch (e: IOException) {
        if (++errors > 20) {
          logLine("read failed repeatedly: ${e.message}")
          break
        }
        sleepQuietly(300)
        continue
      }
      if (n <= 0) {
        if (++errors > 20) break
        sleepQuietly(300)
        continue
      }
      errors = 0
      packetsSeen++
      if (packetsSeen <= 3L) logLine("packet #$packetsSeen arrived")
      handlePacket(buf.copyOf(n))
    }
    closeTun()
  }

  private fun sleepQuietly(ms: Long) {
    try {
      Thread.sleep(ms)
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
    }
  }

  private fun handlePacket(packet: ByteArray) {
    // IPv4, UDP to our DNS port only. Everything else routed into the tunnel
    // is dropped, which is nothing — the route table only carries DNS.
    if (packet.size < 28) return
    if ((packet[0].toInt() and 0xF0) != 0x40) return // not IPv4
    if (packet[9].toInt() != 17) return // not UDP
    val protoLen = ((packet[2].toInt() and 0xFF) shl 8) or (packet[3].toInt() and 0xFF)
    val limit = minOf(protoLen, packet.size)

    val srcIp = readInt(packet, 12)
    val srcPort = ((packet[20].toInt() and 0xFF) shl 8) or (packet[21].toInt() and 0xFF)
    val dstPort = ((packet[22].toInt() and 0xFF) shl 8) or (packet[23].toInt() and 0xFF)
    if (dstPort != 53) return

    val udpLen = ((packet[24].toInt() and 0xFF) shl 8) or (packet[25].toInt() and 0xFF)
    val payloadLen = minOf(udpLen - 8, limit - 28)
    if (payloadLen <= 0) return

    // DNS starts 28 bytes in (20 IPv4 + 8 UDP). Parse ONLY the DNS message,
    // never the outer headers.
    val dnsPayload = packet.copyOfRange(28, 28 + payloadLen)
    val dns = Dns.tryParse(dnsPayload, payloadLen, srcIp, srcPort) ?: return
    parsedSeen++

    if (Blocker.isBlocked(dns.domain)) {
      lastDomain = dns.domain
      Reporter.event(dns.domain, isBlocked = true)
      return // no answer: the domain simply never resolves
    }

    Reporter.event(dns.domain, isBlocked = false)
    lastDomain = dns.domain
    resolvers.execute { answer(dns) }
  }

  /** Forwards the question to the filtering resolver and relays the answer. */
  private fun answer(query: DnsQuery) {
    try {
      DatagramSocket().use { socket ->
        socket.soTimeout = 2_000
        protect(socket)
        val server = InetAddress.getByName(Config.RESOLVER_V4)
        socket.send(DatagramPacket(query.raw, query.raw.size, server, 53))

        val response = ByteArray(2048)
        val incoming = DatagramPacket(response, response.size)
        socket.receive(incoming)

        val reply = Packets.buildDnsResponse(
          incoming.data.copyOfRange(0, incoming.length),
          query.srcIp,
          query.srcPort,
        )
        synchronized(writeLock) {
          writer?.write(reply)
          writer?.flush()
        }
      }
    } catch (_: Exception) {
      // Timeout or network drop: the app's query dies quietly, same as a real
      // resolver that never answers.
    }
  }

  private fun closeTun() {
    synchronized(writeLock) { writer?.close(); writer = null }
    try {
      tunFd?.close()
    } catch (_: IOException) {
    }
    tunFd = null
    active = false
    logLine("tunnel closed")
    Reporter.stop()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /** Appends one line to <filesDir>/watch.log so the UI can share exactly
   *  what happened on the device. Also remembers the last line for the screen. */
  private fun logLine(message: String) {
    lastLog = message
    try {
      File(filesDir, "watch.log").appendText("[${System.currentTimeMillis()}] $message\n")
    } catch (_: IOException) {
    }
  }

  override fun onDestroy() {
    reader?.interrupt()
    resolvers.shutdownNow()
    closeTun()
    super.onDestroy()
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    val channelId = "vpn"
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(channelId, getString(R.string.app_name), NotificationManager.IMPORTANCE_LOW),
      )
    }
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, channelId)
      .setContentTitle(getString(R.string.notification_title))
      .setContentText(getString(R.string.notification_text))
      .setSmallIcon(R.drawable.ic_launcher)
      .setContentIntent(open)
      .setOngoing(true)
      .build()
  }

  private fun readInt(data: ByteArray, off: Int): Int =
    ((data[off].toInt() and 0xFF) shl 24) or ((data[off + 1].toInt() and 0xFF) shl 16) or
      ((data[off + 2].toInt() and 0xFF) shl 8) or (data[off + 3].toInt() and 0xFF)

  companion object {
    private const val NOTIFICATION_ID = 1

    /** True from establish() until the tunnel closes. Read by the UI. */
    @Volatile var active: Boolean = false

    /** Last domain the tunnel parsed, so the UI can prove capture works. */
    @Volatile var lastDomain: String? = null

    /** Raw packets that came out of the tunnel (should rise while browsing). */
    @Volatile var packetsSeen: Long = 0

    /** Of those packets, how many were recognisable DNS queries. */
    @Volatile var parsedSeen: Long = 0

    /** Last lifecycle line, also appended to watch.log. */
    @Volatile var lastLog: String? = null

    /** Full log text for the share button (may be empty). */
    fun logText(context: android.content.Context): String =
      try {
        File(context.filesDir, "watch.log").readText().ifEmpty { "no log yet" }
      } catch (_: IOException) {
        "no log yet"
      }

    fun start(context: android.content.Context) {
      ContextCompat.startForegroundService(context, Intent(context, WatchVpnService::class.java))
    }
  }
}