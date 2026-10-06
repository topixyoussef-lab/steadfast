package com.steadfast.watch

/**
 * Domain block list. Version 1 ships with a small built-in set and works hard
 * on reporting (the consent agreement's core); the block side can later pull a
 * live list from the backend. Matching is a suffix match, so the whole domain
 * and every subdomain below it are covered.
 */
object Blocker {
  private val BLOCKED = setOf(
    "pornhub.com",
    "xvideos.com",
    "xhamster.com",
    "xnxx.com",
    "redtube.com",
    "youporn.com",
    "tube8.com",
    "brazzers.com",
  )

  fun isBlocked(domain: String): Boolean {
    val d = domain.trimEnd('.')
    if (BLOCKED.contains(d)) return true
    return BLOCKED.any { block -> d.endsWith(".$block") }
  }
}