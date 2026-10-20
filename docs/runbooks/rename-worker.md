# Runbook: rename the Worker from `trix` to `hack-limits`

**Why:** the product is now Hack Limits; the Worker name sets the public `workers.dev` address.
Cloudflare Worker names allow only lowercase letters, digits and dashes, so the name is
`hack-limits`, not `hack.limits`.

**What a rename really is:** Cloudflare treats it as a new script. Several things stay with the old
`trix` script and must be moved by hand. Doing it in this order keeps the bot answering.

<table>
  <tr><th>Tied to the script name</th><th>What happens</th></tr>
  <tr><td>Worker secrets (11 today: ADMIN_SECRET, FATSECRET_CLIENT_ID, FATSECRET_CLIENT_SECRET, GEMINI_API_KEY, GROQ_API_KEY, MONGODB_URI, OLLAMA_API_KEY, OPENROUTER_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, YOUTUBE_API_KEY)</td><td>Not copied. Cloudflare never returns secret values, so they are entered again for <code>hack-limits</code>.</td></tr>
  <tr><td><code>https://trix.&lt;subdomain&gt;.workers.dev</code></td><td>Becomes <code>https://hack-limits.&lt;subdomain&gt;.workers.dev</code>. The Telegram webhook, the bot's menu button and the Mini App URL in BotFather point at the old one until updated.</td></tr>
  <tr><td>Durable Objects (scheduler DOs)</td><td>New namespaces with empty storage. Reminders keep working through the cron; the outbox in D1 dedupes by idempotency key, so the brief overlap of two Workers cannot double-send.</td></tr>
  <tr><td>Queue consumer for <code>trix-broadcast</code></td><td>A queue has one consumer; it must be released from <code>trix</code> before <code>hack-limits</code> deploys.</td></tr>
  <tr><td>D1 <code>trix</code>, R2 buckets, rate-limit namespaces, Analytics Engine</td><td>Unchanged: bound by id/name in <code>wrangler.toml</code>, not by the script.</td></tr>
</table>

## Steps

All commands are live actions; run them yourself (or approve each one).

1. **Merge the native-app PR first** (#87) so its migrations and code are what `hack-limits` runs.
2. **Secrets on the new name** — for each secret above, plus the new ones (`GOOGLE_CLIENT_ID`,
   `AUTH_SECRET`, `RESEND_API_KEY`, `FCM_SERVICE_ACCOUNT`):

   ```powershell
   npx wrangler secret put TELEGRAM_BOT_TOKEN --name hack-limits
   # ...repeat per secret; the service-account key from a file outside the repo:
   npx wrangler secret put FCM_SERVICE_ACCOUNT --name hack-limits < C:\path\outside\repo\service-account.json
   ```
3. **Release the queue:** `npx wrangler queues consumer remove trix-broadcast trix`
4. **Merge this PR.** The deploy workflow (manual approval) creates `hack-limits` with the same D1,
   applies any pending migrations and starts its cron.
5. **Point Telegram at it:** set the GitHub variable / `WORKER_URL` to
   `https://hack-limits.<subdomain>.workers.dev`, then run `node scripts/setup-telegram.mjs`
   (webhook + menu button). In BotFather update the Mini App URL (`/myapps` → the app → edit URL).
6. **Check:** `GET /health` and `/health/db` return 200 on the new address; send the bot a message;
   open the Mini App from Telegram.
7. **Retire the old Worker** once step 6 passes: `npx wrangler delete --name trix`. Until then both
   crons run; the shared outbox keeps reminders single.
8. **Native app:** build with `-Phacklimits.apiBaseUrl=https://hack-limits.<subdomain>.workers.dev`
   and `-Phacklimits.privacyPolicyUrl=https://hack-limits.<subdomain>.workers.dev/privacy.html`.

**Rollback:** if the new Worker misbehaves before step 7, run `setup-telegram.mjs` with the old
`WORKER_URL` and restore the BotFather URL; the old `trix` Worker is still deployed and complete.
