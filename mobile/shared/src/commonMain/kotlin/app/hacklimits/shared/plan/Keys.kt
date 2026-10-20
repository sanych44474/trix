package app.hacklimits.shared.plan

import kotlin.random.Random

/** A fresh Idempotency-Key for a write, so a lost-response retry is replayed server-side, not repeated. */
fun newIdempotencyKey(): String = Random.nextBytes(16).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
