-- Voluntary support in Telegram Stars (XTR). The product stays free; this only records what
-- people chose to give, so the owner can thank them and a refund (refundStarPayment needs the
-- charge id) stays possible. One row per successful payment; chargeId is Telegram's
-- telegram_payment_charge_id and is unique, so a redelivered update never double-counts.
CREATE TABLE IF NOT EXISTS v2_support_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  accountId INTEGER NOT NULL REFERENCES v2_accounts(id) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  chargeId TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_v2_support_account ON v2_support_payments(accountId);
