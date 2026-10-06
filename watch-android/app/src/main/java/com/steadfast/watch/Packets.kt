package com.steadfast.watch

/** Little endian -> big endian helpers and IP text formatting. */
object Packets {
  fun ipString(value: Int): String =
    "${(value ushr 24) and 0xFF}.${(value ushr 16) and 0xFF}." +
      "${(value ushr 8) and 0xFF}.${value and 0xFF}"

  private fun putShort(out: ByteArray, off: Int, value: Int) {
    out[off] = (value ushr 8 and 0xFF).toByte()
    out[off + 1] = (value and 0xFF).toByte()
  }

  private fun checksum(data: ByteArray, off: Int, len: Int): Int {
    var sum = 0
    var i = off
    while (i < off + len - 1) {
      sum += (data[i].toInt() and 0xFF shl 8) or (data[i + 1].toInt() and 0xFF)
      i += 2
    }
    if (i < off + len) sum += (data[i].toInt() and 0xFF) shl 8
    while (sum > 0xFFFF) sum = (sum and 0xFFFF) + (sum ushr 16)
    return sum
  }

  private fun checksumWrap(carry: Int): Short {
    val sum = (carry and 0xFFFF) + (carry ushr 16)
    return (sum.inv() and 0xFFFF).toShort()
  }

  /**
   * Wraps an upstream DNS response (already carrying the query id, so no value
   * needs to be rewritten) as a full IPv4/UDP packet addressed back to the app
   * that asked. src/dst are swapped vs the query: we are 10.0.0.1:53.
   */
  fun buildDnsResponse(dnsPayload: ByteArray, srcIp: Int, srcPort: Int): ByteArray {
    val udpLen = 8 + dnsPayload.size
    val totalLen = 20 + udpLen
    val out = ByteArray(totalLen)

    // IPv4 header, IHL 5, no options.
    out[0] = 0x45.toByte()
    putShort(out, 2, totalLen)
    out[8] = 64.toByte() // TTL
    out[9] = 17.toByte() // UDP protocol
    out[12] = (Config.TUN_DNS ushr 24).toByte()
    out[13] = (Config.TUN_DNS ushr 16).toByte()
    out[14] = (Config.TUN_DNS ushr 8).toByte()
    out[15] = Config.TUN_DNS.toByte()
    out[16] = (srcIp ushr 24).toByte()
    out[17] = (srcIp ushr 16).toByte()
    out[18] = (srcIp ushr 8).toByte()
    out[19] = srcIp.toByte()
    putShort(out, 10, checksumWrap(checksum(out, 0, 20)))

    // UDP header + payload.
    putShort(out, 22, 53) // source port (our DNS)
    putShort(out, 24, srcPort)
    putShort(out, 26, udpLen)
    dnsPayload.copyInto(out, 28)

    // UDP checksum over pseudo-header (src, dst, 0/17/udpLen) + header + data.
    val udpSum =
      checksum(out, 20, udpLen) +
        ((Config.TUN_DNS ushr 16) and 0xFFFF) +
        (Config.TUN_DNS and 0xFFFF) +
        ((srcIp ushr 16) and 0xFFFF) +
        (srcIp and 0xFFFF) +
        17 +
        udpLen
    putShort(out, 26 + 2, checksumWrap(udpSum))

    return out
  }
}