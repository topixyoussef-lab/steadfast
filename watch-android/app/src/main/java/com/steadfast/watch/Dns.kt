package com.steadfast.watch

/**
 * A single DNS question, taken from an upstream UDP:53 packet. Only the first
 * question is read (that is all a resolver answers in practice), and only A /
 * AAAA / ANY questions are forwarded — enough for every browser and app today.
 */
data class DnsQuery(
  val id: Int,
  val domain: String,
  val raw: ByteArray,
  val srcIp: Int,
  val srcPort: Int,
)

object Dns {
  fun tryParse(packet: ByteArray, len: Int, srcIp: Int, srcPort: Int): DnsQuery? {
    if (len < 12) return null

    // Header: id + flags. Skip responses and anything that is not a standard
    // query so we never loop our own forwarded answers back.
    val flags = ((packet[2].toInt() and 0xFF) shl 8) or (packet[3].toInt() and 0xFF)
    if (flags and 0x8000 != 0) return null // QR = response

    val qdCount = ((packet[4].toInt() and 0xFF) shl 8) or (packet[5].toInt() and 0xFF)
    if (qdCount < 1) return null

    var i = 12
    val parts = mutableListOf<String>()
    var labels = 0
    while (i < len) {
      val l = packet[i].toInt() and 0xFF
      if (l == 0) {
        i++
        break
      }
      if (l > 63 || i + 1 + l > len) return null
      val sb = StringBuilder()
      for (k in 1..l) sb.append((packet[i + k].toInt() and 0xFF).toChar())
      parts.add(sb.toString())
      i += l + 1
      if (++labels > 127) return null
    }
    if (parts.isEmpty() || parts.any { it.isEmpty() }) return null

    // After the name sit qtype/qclass (4 bytes); then the rest of the packet.
    if (i + 4 > len) return null
    val qtype = ((packet[i].toInt() and 0xFF) shl 8) or (packet[i + 1].toInt() and 0xFF)
    if (qtype != 1 && qtype != 28 && qtype != 255) return null // A, AAAA, ANY

    val id = (packet[0].toInt() and 0xFF shl 8) or (packet[1].toInt() and 0xFF)
    val raw = packet.copyOfRange(0, len)
    return DnsQuery(id, parts.joinToString("."), raw, srcIp, srcPort)
  }
}