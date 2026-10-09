/**
 * Schema migrations.
 *
 * Migrations are plain SQL kept in source so they can be reviewed line by line
 * and applied identically to a managed PostgreSQL instance and to the embedded
 * engine, with no filesystem access at runtime. Each migration is a list of
 * single statements, applied in order inside one transaction.
 *
 * Integrity rules that must hold no matter what the application code does are
 * enforced here, in the database:
 *   - customer accounts cannot be overdrawn                (CHECK constraint)
 *   - a transaction's ledger entries must balance to zero  (deferred trigger)
 *   - ledger entries, status events and audit records are
 *     append-only                                          (triggers)
 *   - the financial facts of a transaction never change    (trigger)
 */

export type Migration = { id: string; statements: string[] };

const init: Migration = {
  id: "0001_init",
  statements: [
    `CREATE TABLE users (
      id text PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('customer', 'operator', 'admin')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      phone text,
      company text,
      two_factor_enabled boolean NOT NULL DEFAULT false,
      notify_transfers boolean NOT NULL DEFAULT true,
      notify_security boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`,

    `CREATE TABLE accounts (
      id text PRIMARY KEY,
      owner_id text REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('customer', 'system')),
      type text NOT NULL,
      name text NOT NULL,
      number text NOT NULL UNIQUE,
      currency text NOT NULL CHECK (char_length(currency) = 3),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
      posted_minor bigint NOT NULL DEFAULT 0,
      held_minor bigint NOT NULL DEFAULT 0 CHECK (held_minor >= 0),
      allow_negative boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT accounts_owner_matches_kind CHECK ((kind = 'customer') = (owner_id IS NOT NULL)),
      CONSTRAINT accounts_no_overdraft CHECK (allow_negative OR posted_minor - held_minor >= 0)
    )`,
    `CREATE INDEX accounts_owner_idx ON accounts (owner_id)`,

    `CREATE TABLE beneficiaries (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('internal', 'external')),
      name text NOT NULL,
      nickname text,
      email text,
      bank_name text NOT NULL,
      account_number text NOT NULL,
      routing_code text,
      country text NOT NULL,
      currency text NOT NULL CHECK (char_length(currency) = 3),
      internal_account_id text REFERENCES accounts(id),
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      CONSTRAINT beneficiaries_internal_has_account CHECK ((kind = 'internal') = (internal_account_id IS NOT NULL))
    )`,
    `CREATE INDEX beneficiaries_owner_idx ON beneficiaries (owner_id)`,

    `CREATE TABLE transactions (
      id text PRIMARY KEY,
      reference text NOT NULL UNIQUE,
      idempotency_scope text NOT NULL,
      idempotency_key text NOT NULL,
      request_hash text NOT NULL,
      initiated_by text REFERENCES users(id),
      type text NOT NULL CHECK (type IN (
        'transfer_internal', 'transfer_out', 'transfer_in', 'deposit',
        'withdrawal', 'card_payment', 'fee', 'interest', 'reversal'
      )),
      status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'reversed')),
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      currency text NOT NULL CHECK (char_length(currency) = 3),
      source_account_id text REFERENCES accounts(id),
      destination_account_id text REFERENCES accounts(id),
      beneficiary_id text REFERENCES beneficiaries(id),
      counterparty_name text,
      description text NOT NULL,
      category text,
      failure_reason text,
      reversal_of text REFERENCES transactions(id),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      CONSTRAINT transactions_has_account CHECK (source_account_id IS NOT NULL OR destination_account_id IS NOT NULL),
      CONSTRAINT transactions_distinct_accounts CHECK (source_account_id IS DISTINCT FROM destination_account_id)
    )`,
    `CREATE UNIQUE INDEX transactions_idempotency_idx ON transactions (idempotency_scope, idempotency_key)`,
    `CREATE INDEX transactions_source_idx ON transactions (source_account_id, created_at)`,
    `CREATE INDEX transactions_destination_idx ON transactions (destination_account_id, created_at)`,
    `CREATE INDEX transactions_status_idx ON transactions (status, created_at)`,
    `CREATE INDEX transactions_created_idx ON transactions (created_at)`,

    `CREATE TABLE ledger_entries (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      transaction_id text NOT NULL REFERENCES transactions(id),
      account_id text NOT NULL REFERENCES accounts(id),
      direction text NOT NULL CHECK (direction IN ('debit', 'credit')),
      amount_minor bigint NOT NULL CHECK (amount_minor > 0),
      currency text NOT NULL CHECK (char_length(currency) = 3),
      balance_after_minor bigint NOT NULL,
      memo text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, seq)`,
    `CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id)`,

    `CREATE TABLE transaction_events (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      transaction_id text NOT NULL REFERENCES transactions(id),
      from_status text,
      to_status text NOT NULL,
      actor_id text REFERENCES users(id),
      actor_label text NOT NULL,
      note text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX transaction_events_tx_idx ON transaction_events (transaction_id, seq)`,

    `CREATE TABLE audit_logs (
      seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      id text NOT NULL UNIQUE,
      actor_id text,
      actor_label text NOT NULL,
      actor_role text NOT NULL,
      action text NOT NULL,
      entity_type text NOT NULL,
      entity_id text,
      summary text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip text,
      user_agent text,
      prev_hash text NOT NULL,
      hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX audit_logs_created_idx ON audit_logs (created_at)`,
    `CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, seq)`,
    `CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id)`,

    `CREATE TABLE notifications (
      id text PRIMARY KEY,
      user_id text NOT NULL REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('transaction', 'security', 'account', 'system')),
      title text NOT NULL,
      body text NOT NULL,
      href text,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX notifications_user_idx ON notifications (user_id, created_at)`,

    // --- System accounts ------------------------------------------------------
    // The bank side of every movement. Because each transaction balances, the
    // sum of all account balances in a currency is always exactly zero.
    `INSERT INTO accounts (id, kind, type, name, number, currency, allow_negative) VALUES
      ('acc_sys_clearing_usd', 'system', 'clearing', 'Compensación externa · USD', 'SYS-CLEARING-USD', 'USD', true),
      ('acc_sys_transit_usd', 'system', 'transit', 'Pagos en tránsito · USD', 'SYS-TRANSIT-USD', 'USD', true),
      ('acc_sys_fees_usd', 'system', 'fees', 'Ingresos por comisiones · USD', 'SYS-FEES-USD', 'USD', true),
      ('acc_sys_interest_usd', 'system', 'interest', 'Gasto por intereses · USD', 'SYS-INTEREST-USD', 'USD', true),
      ('acc_sys_clearing_eur', 'system', 'clearing', 'Compensación externa · EUR', 'SYS-CLEARING-EUR', 'EUR', true),
      ('acc_sys_transit_eur', 'system', 'transit', 'Pagos en tránsito · EUR', 'SYS-TRANSIT-EUR', 'EUR', true),
      ('acc_sys_fees_eur', 'system', 'fees', 'Ingresos por comisiones · EUR', 'SYS-FEES-EUR', 'EUR', true),
      ('acc_sys_interest_eur', 'system', 'interest', 'Gasto por intereses · EUR', 'SYS-INTEREST-EUR', 'EUR', true)`,

    // --- Append-only tables -------------------------------------------------
    `CREATE FUNCTION aldera_forbid_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
    END;
    $$ LANGUAGE plpgsql`,

    `CREATE TRIGGER ledger_entries_append_only
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION aldera_forbid_mutation()`,
    `CREATE TRIGGER transaction_events_append_only
      BEFORE UPDATE OR DELETE ON transaction_events
      FOR EACH ROW EXECUTE FUNCTION aldera_forbid_mutation()`,
    `CREATE TRIGGER audit_logs_append_only
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION aldera_forbid_mutation()`,

    // --- Double-entry invariant ---------------------------------------------
    // Checked at COMMIT, so a transaction may post its legs in any order but
    // can never commit unless debits equal credits in every currency.
    `CREATE FUNCTION aldera_assert_balanced() RETURNS trigger AS $$
    DECLARE
      imbalance record;
    BEGIN
      SELECT currency,
             SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) AS diff
        INTO imbalance
        FROM ledger_entries
       WHERE transaction_id = NEW.transaction_id
       GROUP BY currency
      HAVING SUM(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
       LIMIT 1;

      IF FOUND THEN
        RAISE EXCEPTION 'ledger entries for transaction % do not balance (% off by %)',
          NEW.transaction_id, imbalance.currency, imbalance.diff
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql`,

    `CREATE CONSTRAINT TRIGGER ledger_entries_balanced
      AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION aldera_assert_balanced()`,

    // --- Immutable financial facts ------------------------------------------
    // A transaction's status may advance; what it moved, and between whom,
    // may not be rewritten. Corrections are made with reversing transactions.
    `CREATE FUNCTION aldera_protect_transaction() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'transactions cannot be deleted'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;

      IF NEW.id <> OLD.id
         OR NEW.reference <> OLD.reference
         OR NEW.idempotency_scope <> OLD.idempotency_scope
         OR NEW.idempotency_key <> OLD.idempotency_key
         OR NEW.request_hash <> OLD.request_hash
         OR NEW.type <> OLD.type
         OR NEW.amount_minor <> OLD.amount_minor
         OR NEW.currency <> OLD.currency
         OR NEW.source_account_id IS DISTINCT FROM OLD.source_account_id
         OR NEW.destination_account_id IS DISTINCT FROM OLD.destination_account_id
         OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
         OR NEW.created_at <> OLD.created_at
      THEN
        RAISE EXCEPTION 'financial fields of transaction % are immutable', OLD.id
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,

    `CREATE TRIGGER transactions_protected
      BEFORE UPDATE OR DELETE ON transactions
      FOR EACH ROW EXECUTE FUNCTION aldera_protect_transaction()`,
  ],
};

export const migrations: Migration[] = [init];
