-- Cinefield Phase 10 — Credit wallet, reservations, immutable ledger and
-- atomic reserve/settle/refund.
--
-- ===========================================================================
-- WHY THIS MIGRATION EXISTS
-- ===========================================================================
-- Until now the entire credit truth was `profiles.credits`, a plain integer
-- that the browser role could UPDATE. Two separate problems follow from that,
-- and only one of them is the race condition we set out to fix:
--
--   1. PRIVILEGE ESCALATION (critical, exploitable with a single request).
--      `profiles` grants UPDATE to `authenticated`, and the RLS policy
--      `profiles_update_own` restricts WHICH ROW may be written but not WHICH
--      COLUMN. A signed-in user can therefore run, straight from the browser:
--          supabase.from('profiles').update({ credits: 999999 })
--                  .eq('clerk_user_id', <their own id>)
--      and mint unlimited credits. Every generation they then run is billed
--      to the platform's provider account. No concurrency needed.
--
--   2. TOCTOU / DOUBLE SPEND (classic race).
--      Reading the balance in the API and writing it back later leaves a gap.
--      Four parallel requests each read "10 credits" before any of them
--      writes, so all four pass the check and all four run. The fix cannot
--      live in application code; the check and the decrement must be one
--      atomic statement inside the database.
--
-- Both are closed here: column-level privileges remove (1), and a row-locked
-- SECURITY DEFINER function removes (2).
--
-- ===========================================================================
-- WHY A WALLET + LEDGER INSTEAD OF ONE INTEGER
-- ===========================================================================
-- A single mutable integer cannot answer the questions this business must
-- answer: why is the balance what it is, which generation consumed what, what
-- was refunded when a provider failed, and what must be clawed back when a
-- card payment is disputed weeks later. So:
--
--   credit_wallets       current balance (fast path, one row per user)
--   credit_reservations  money held for an in-flight generation
--   credit_ledger        append-only history; the audit trail
--
-- The ledger is INSERT-only by design. Balances are derived state that must
-- always be reconstructable from it. `profiles.credits` is kept in sync as a
-- read-only mirror so existing UI queries keep working unchanged.
--
-- RESERVE -> SETTLE / REFUND, and why reservation comes first:
-- credits are reserved BEFORE the provider is called. If reservation fails,
-- no provider request is ever made and nothing is billable. If the provider
-- later fails, the reservation is refunded automatically. The reverse order
-- ("generate, then charge") is unrecoverable: the GPU cost is already spent.
--
-- ADDITIVE AND REVERSIBLE
-- No existing table is dropped or renamed. `profiles.credits` keeps its name,
-- type and meaning; it simply stops being writable by the browser. Existing
-- reads are unaffected.
--
-- ===========================================================================
-- REVIEW FIXES APPLIED (2026-08-11, before this migration ever ran anywhere)
-- ===========================================================================
-- An adversarial review of this migration + its API route + its test suite
-- found three issues, fixed in place here rather than as a follow-up patch:
--
--   1. grant_credits() had NO database-level backstop for its idempotency
--      check (unlike reserve_credits(), which is protected by
--      credit_reservations_user_idem_uniq even though its own idempotency
--      check has the same check-then-act shape). Two concurrent identical
--      Stripe webhook deliveries — which Stripe's own docs say WILL happen —
--      could each pass the "not yet processed" check before either commits,
--      then each apply the grant/clawback once the wallet lock frees up,
--      double-granting or double-clawing-back real money. Fixed by adding
--      credit_ledger_external_ref_type_uniq below, mirroring the exact
--      pattern already used for reservations.
--
--   2. reserve_credits()'s replayed-request branch omitted generation_id
--      from its return value, even though the row being read (v_existing)
--      has it. A caller relying on this response to redirect a duplicate
--      request back to the original generation would always receive null.
--      Fixed by including it.
--
--   3. Neither reserve_credits() nor grant_credits() caught the
--      unique_violation their own idempotency race could still surface as a
--      raw, ugly error to a true concurrent duplicate (the new unique index
--      in fix 1, and the existing one behind fix 2's function, make this
--      SAFE — no double charge/grant occurs either way — but previously a
--      losing concurrent caller saw a generic Postgres error instead of a
--      graceful "someone else already did this" response). Fixed by adding
--      an EXCEPTION WHEN unique_violation handler to both functions that
--      re-reads the winning row and returns it exactly as the normal
--      idempotency-hit path would.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. CLOSE THE PRIVILEGE ESCALATION HOLE
-- ---------------------------------------------------------------------------
-- Postgres has no "UPDATE every column except credits" grant, so the blanket
-- table-level UPDATE is revoked and re-granted per column. The user keeps
-- control of their own profile fields; `credits` and `plan` become
-- server-only, because both are money-bearing: `plan` decides pricing tier
-- and concurrency limits, so a self-granted 'enterprise' is also an exploit.
REVOKE UPDATE ON TABLE "public"."profiles" FROM "authenticated";

-- `email` IS IN THIS LIST DELIBERATELY, AND IT IS NOT AN OVERSIGHT.
-- ProfileSynchronizer (mounted in the root layout) upserts Clerk's contact
-- metadata for every signed-in user, and PostgREST puts every supplied column
-- into the ON CONFLICT SET list — so omitting `email` here would deny the
-- UPDATE half of that upsert for every existing profile, silently, since the
-- component swallows its errors. It is safe to allow because `email` carries
-- no authority in this schema: identity, authorization, ownership and credits
-- are all keyed on `clerk_user_id`, nothing reads profiles.email to make a
-- decision, and profiles_update_own restricts the write to the caller's own
-- row via USING + WITH CHECK. `credits` and `plan` stay off this list — those
-- are the money-bearing columns this whole block exists to protect.
GRANT UPDATE ("username", "display_name", "avatar_url", "email")
  ON TABLE "public"."profiles" TO "authenticated";

-- INSERT is likewise narrowed. Self-provisioning a row with a starting
-- balance is the same exploit through a different door; the Clerk webhook
-- (service_role) is what creates profiles.
REVOKE INSERT ON TABLE "public"."profiles" FROM "authenticated";

GRANT INSERT ("clerk_user_id", "username", "email", "display_name", "avatar_url")
  ON TABLE "public"."profiles" TO "authenticated";

-- service_role must retain full access: it runs the webhook, the workers and
-- these functions' owner-side operations.
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


-- ---------------------------------------------------------------------------
-- 1. credit_wallets — the fast-path balance
-- ---------------------------------------------------------------------------
-- One row per user. `balance` is spendable credits; `reserved` is the amount
-- currently held by in-flight generations. They are tracked separately so the
-- UI can honestly show "you have 40 credits, 10 of them are working right
-- now" instead of a number that silently dips and recovers.
--
-- CHECK (balance >= 0) is the last line of defence: even if a future function
-- is written wrongly, the database refuses to go negative rather than quietly
-- lending the user money that becomes a provider invoice.
CREATE TABLE IF NOT EXISTS "public"."credit_wallets" (
    "clerk_user_id" "text" NOT NULL,
    "balance" integer DEFAULT 0 NOT NULL,
    "reserved" integer DEFAULT 0 NOT NULL,
    -- Lifetime counters, useful for support and abuse triage without
    -- aggregating the whole ledger on every request.
    "lifetime_granted" bigint DEFAULT 0 NOT NULL,
    "lifetime_spent" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_wallets_pkey" PRIMARY KEY ("clerk_user_id"),
    CONSTRAINT "credit_wallets_balance_check" CHECK (("balance" >= 0)),
    CONSTRAINT "credit_wallets_reserved_check" CHECK (("reserved" >= 0))
);

ALTER TABLE "public"."credit_wallets" OWNER TO "postgres";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'credit_wallets_clerk_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."credit_wallets"
      ADD CONSTRAINT "credit_wallets_clerk_user_id_fkey"
      FOREIGN KEY ("clerk_user_id") REFERENCES "public"."profiles"("clerk_user_id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE OR REPLACE TRIGGER "credit_wallets_set_updated_at"
  BEFORE UPDATE ON "public"."credit_wallets"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------------
-- 2. credit_reservations — money held for one in-flight generation
-- ---------------------------------------------------------------------------
-- A reservation is the bridge between "the user can afford this" and "the
-- provider actually did the work". Its lifecycle mirrors the generation:
--   held      credits are set aside, provider call may proceed
--   settled   generation succeeded; credits are permanently consumed
--   refunded  generation failed or was cancelled; credits returned
--   expired   reaper reclaimed a reservation whose generation vanished
--
-- WHY generation_id IS UNIQUE (partial, on live rows):
-- one generation may hold credits exactly once. A Temporal activity retried
-- after a crash cannot create a second hold, because the index rejects it —
-- the same technique already used by generation_attempts_one_active_uniq.
--
-- WHY idempotency_key EXISTS:
-- it is the browser-supplied identifier for one user intent. Two clicks, or a
-- client retry after a network timeout, carry the same key and therefore
-- reserve credits once. This is what makes "the user pressed Generate twice"
-- cost one credit charge rather than two.
CREATE TABLE IF NOT EXISTS "public"."credit_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clerk_user_id" "text" NOT NULL,
    "generation_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "amount" integer NOT NULL,
    "status" "text" DEFAULT 'held'::"text" NOT NULL,
    -- Pricing inputs recorded as computed, so a later dispute can be answered
    -- with "this is what was quoted and why" instead of a recomputation that
    -- may use today's prices.
    "quote" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    -- Safety net for holds whose generation never reaches a terminal state
    -- (worker lost, process killed). The reaper refunds anything past this.
    "expires_at" timestamp with time zone DEFAULT ("now"() + interval '2 hours') NOT NULL,
    "settled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_reservations_amount_check" CHECK (("amount" > 0)),
    CONSTRAINT "credit_reservations_status_check" CHECK (("status" = ANY (ARRAY[
      'held'::"text", 'settled'::"text", 'refunded'::"text", 'expired'::"text"
    ]))),
    CONSTRAINT "credit_reservations_idempotency_key_check"
      CHECK ((("char_length"("idempotency_key") >= 8) AND ("char_length"("idempotency_key") <= 200))),
    CONSTRAINT "credit_reservations_settled_at_check" CHECK (
      ("settled_at" IS NULL) OR ("status" <> 'held'::"text")
    )
);

ALTER TABLE "public"."credit_reservations" OWNER TO "postgres";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'credit_reservations_clerk_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."credit_reservations"
      ADD CONSTRAINT "credit_reservations_clerk_user_id_fkey"
      FOREIGN KEY ("clerk_user_id") REFERENCES "public"."profiles"("clerk_user_id")
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'credit_reservations_generation_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."credit_reservations"
      ADD CONSTRAINT "credit_reservations_generation_id_fkey"
      FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- ONE INTENT = ONE CHARGE. The double-click guard, enforced by the database
-- rather than by application convention.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_reservations_user_idem_uniq"
  ON "public"."credit_reservations" ("clerk_user_id", "idempotency_key");

-- ONE LIVE HOLD PER GENERATION.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_reservations_generation_live_uniq"
  ON "public"."credit_reservations" ("generation_id")
  WHERE (("generation_id" IS NOT NULL) AND ("status" = 'held'::"text"));

-- Concurrency counting and the expiry reaper both scan live holds.
CREATE INDEX IF NOT EXISTS "credit_reservations_user_status_idx"
  ON "public"."credit_reservations" ("clerk_user_id", "status");

CREATE INDEX IF NOT EXISTS "credit_reservations_expiry_idx"
  ON "public"."credit_reservations" ("expires_at")
  WHERE ("status" = 'held'::"text");

CREATE OR REPLACE TRIGGER "credit_reservations_set_updated_at"
  BEFORE UPDATE ON "public"."credit_reservations"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------------
-- 3. credit_ledger — append-only money history
-- ---------------------------------------------------------------------------
-- Every balance change writes exactly one row. `balance_after` is stored so
-- the ledger can be verified against the wallet without replaying history,
-- which is how silent drift (the symptom of a real bug) gets detected.
--
-- `entry_type` covers the events this business actually has, including the
-- ones that only appear weeks later: `chargeback` is what a disputed card
-- payment writes, and it is the reason the ledger cannot be a mutable
-- counter — clawback must be recorded, not silently subtracted.
CREATE TABLE IF NOT EXISTS "public"."credit_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clerk_user_id" "text" NOT NULL,
    "entry_type" "text" NOT NULL,
    -- Signed: negative consumes, positive grants. The sign is the direction
    -- of money, so a SUM over this column must always equal the wallet.
    "amount" integer NOT NULL,
    "balance_after" integer NOT NULL,
    "reservation_id" "uuid",
    "generation_id" "uuid",
    -- Stripe payment/charge/dispute id, admin actor, or grant reason.
    "external_ref" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credit_ledger_entry_type_check" CHECK (("entry_type" = ANY (ARRAY[
      'purchase'::"text",      -- Stripe payment succeeded
      'grant'::"text",         -- signup bonus, promo, support gesture
      'reserve'::"text",       -- credits held for a generation
      'settle'::"text",        -- hold consumed (bookkeeping, balance unchanged)
      'refund'::"text",        -- hold returned to balance
      'chargeback'::"text",    -- disputed payment clawed back
      'expire'::"text",        -- credits expired by policy
      'admin_adjust'::"text"   -- manual correction, always attributed
    ]))),
    CONSTRAINT "credit_ledger_balance_after_check" CHECK (("balance_after" >= 0))
);

ALTER TABLE "public"."credit_ledger" OWNER TO "postgres";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'credit_ledger_clerk_user_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."credit_ledger"
      ADD CONSTRAINT "credit_ledger_clerk_user_id_fkey"
      FOREIGN KEY ("clerk_user_id") REFERENCES "public"."profiles"("clerk_user_id")
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "credit_ledger_user_created_idx"
  ON "public"."credit_ledger" ("clerk_user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "credit_ledger_generation_idx"
  ON "public"."credit_ledger" ("generation_id")
  WHERE ("generation_id" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "credit_ledger_external_ref_idx"
  ON "public"."credit_ledger" ("external_ref")
  WHERE ("external_ref" IS NOT NULL);

-- REVIEW FIX 1 (see header): grant_credits()'s idempotency check
-- (`external_ref` + `entry_type`, no row lock) previously had no
-- database-level backstop the way credit_reservations_user_idem_uniq backs
-- reserve_credits() up. Two concurrent identical webhook deliveries could
-- each pass the check before either committed. This unique index makes a
-- second identical (external_ref, entry_type) pair IMPOSSIBLE at the
-- database level, mirroring the exact protection reservations already had.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_external_ref_type_uniq"
  ON "public"."credit_ledger" ("external_ref", "entry_type")
  WHERE ("external_ref" IS NOT NULL);

-- IMMUTABILITY, ENFORCED. A ledger that can be edited is not a ledger. This
-- also protects against a compromised service_role key rewriting history:
-- corrections must be new compensating rows (admin_adjust), never edits.
CREATE OR REPLACE FUNCTION "public"."credit_ledger_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only (attempted %)', TG_OP;
END;
$$;

ALTER FUNCTION "public"."credit_ledger_immutable"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "credit_ledger_no_update" ON "public"."credit_ledger";
CREATE TRIGGER "credit_ledger_no_update"
  BEFORE UPDATE OR DELETE ON "public"."credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION "public"."credit_ledger_immutable"();


-- ---------------------------------------------------------------------------
-- 4. plan limits — concurrency is a cost control, not a UX preference
-- ---------------------------------------------------------------------------
-- A free account allowed unlimited parallel generations is a free account
-- allowed to spend the platform's provider budget as fast as the network
-- permits. Capping concurrent live reservations bounds the damage of a bot
-- flood to (limit x cost) regardless of how many requests are fired.
CREATE TABLE IF NOT EXISTS "public"."plan_limits" (
    "plan" "text" NOT NULL,
    "max_concurrent_generations" integer NOT NULL,
    "monthly_credit_grant" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("plan"),
    CONSTRAINT "plan_limits_plan_check" CHECK (("plan" = ANY (ARRAY[
      'free'::"text", 'starter'::"text", 'pro'::"text",
      'business'::"text", 'enterprise'::"text"
    ]))),
    CONSTRAINT "plan_limits_concurrency_check" CHECK (("max_concurrent_generations" >= 1))
);

ALTER TABLE "public"."plan_limits" OWNER TO "postgres";

INSERT INTO "public"."plan_limits" ("plan", "max_concurrent_generations", "monthly_credit_grant")
VALUES
  ('free',        1,  0),
  ('starter',     2,  0),
  ('pro',         4,  0),
  ('business',    8,  0),
  ('enterprise', 16,  0)
ON CONFLICT ("plan") DO NOTHING;

CREATE OR REPLACE TRIGGER "plan_limits_set_updated_at"
  BEFORE UPDATE ON "public"."plan_limits"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------------
-- 5. BACKFILL — migrate existing balances without losing anything
-- ---------------------------------------------------------------------------
-- Every existing profile gets a wallet seeded from its current integer, and
-- an opening ledger entry so the history starts complete rather than with an
-- unexplained balance.
INSERT INTO "public"."credit_wallets" ("clerk_user_id", "balance", "lifetime_granted")
SELECT "clerk_user_id", "credits", "credits"
FROM "public"."profiles"
ON CONFLICT ("clerk_user_id") DO NOTHING;

-- Note: an opening entry is written even for a zero balance, so that EVERY
-- wallet has a complete history and the reconciliation invariant
-- (SUM(ledger) = balance + reserved) holds for every row from day one.
--
-- THE external_ref CARRIES THE OWNER, AND IT HAS TO.
-- credit_ledger_external_ref_type_uniq is GLOBAL over (external_ref,
-- entry_type) — deliberately, because it backstops grant_credits() against
-- a replayed Stripe event, and a Stripe event id is globally unique by
-- nature. A backfill that wrote the same literal ref for every wallet would
-- therefore succeed for the first row and fail for the second: the guard
-- below filters per user, but the constraint does not. Suffixing the owner
-- makes each opening entry its own globally-unique ref, which is what the
-- constraint is asking for, and leaves the Stripe protection exactly as
-- strong as it was. Widening the index to include clerk_user_id would have
-- been the other way to make this insert pass — and it would have let the
-- same webhook event be applied once per user, so it is not an option.
INSERT INTO "public"."credit_ledger"
  ("clerk_user_id", "entry_type", "amount", "balance_after", "external_ref", "metadata")
SELECT w."clerk_user_id", 'grant', w."balance", w."balance",
       'migration:opening_balance:' || w."clerk_user_id",
       jsonb_build_object('source', 'profiles.credits')
FROM "public"."credit_wallets" w
WHERE NOT EXISTS (
    SELECT 1 FROM "public"."credit_ledger" l
    WHERE l."clerk_user_id" = w."clerk_user_id"
      AND l."external_ref" = 'migration:opening_balance:' || w."clerk_user_id"
  );


-- ---------------------------------------------------------------------------
-- 6. reserve_credits() — the atomic gate
-- ---------------------------------------------------------------------------
-- This is the single function that decides whether a generation may cost
-- money. Everything about the concurrency bug is solved by two details:
--
--   SECURITY DEFINER  the function runs as its owner, so the tables can stay
--                     completely unreachable by the browser role while this
--                     one narrow, audited entry point remains callable.
--
--   FOR UPDATE        the wallet row is locked before it is read. A second
--                     concurrent call blocks here until the first commits,
--                     and then reads the ALREADY DECREMENTED balance. Four
--                     parallel requests are serialised by the database, so
--                     exactly as many succeed as the balance allows.
--
-- The idempotency check runs first and returns the existing hold unchanged,
-- so a retried request is free rather than a second charge.
--
-- REVIEW FIX 2 (see header): the replayed branch now includes
-- v_existing.generation_id — a caller reading this response to redirect a
-- duplicate request back to the original generation previously always got
-- null, because the field was silently omitted despite being available on
-- the row already being read.
--
-- REVIEW FIX 3 (see header): a true concurrent duplicate (same idempotency
-- key, both callers pass the initial "not found" check before either
-- commits) is still made safe by credit_reservations_user_idem_uniq — the
-- losing caller's INSERT raises unique_violation, which PL/pgSQL
-- automatically rolls back to the start of this EXCEPTION-guarded block,
-- undoing that caller's wallet decrement. Previously that error propagated
-- raw to the caller; it is now caught and answered with the same graceful
-- replayed response the normal idempotency-hit path returns.
--
-- NOTE ON search_path: pinned explicitly. A SECURITY DEFINER function with a
-- caller-controlled search_path is a privilege-escalation vector.
CREATE OR REPLACE FUNCTION "public"."reserve_credits"(
    "p_user_id" "text",
    "p_amount" integer,
    "p_idempotency_key" "text",
    "p_generation_id" "uuid" DEFAULT NULL,
    "p_quote" "jsonb" DEFAULT '{}'::"jsonb"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet      record;
  v_existing    record;
  v_plan        text;
  v_limit       integer;
  v_active      integer;
  v_reservation uuid;
  v_new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  -- (a) Idempotency. Same intent replayed => same reservation, no new charge.
  SELECT * INTO v_existing
  FROM credit_reservations
  WHERE clerk_user_id = p_user_id AND idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'reservation_id', v_existing.id,
      'generation_id',  v_existing.generation_id,
      'amount',         v_existing.amount,
      'status',         v_existing.status,
      'replayed',       true
    );
  END IF;

  -- (b) Lock the wallet. Everything below this line is serialised per user.
  SELECT * INTO v_wallet
  FROM credit_wallets
  WHERE clerk_user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No wallet means no funded account. Creating one here with a balance
    -- would be a free-credit faucet, so this is a hard failure.
    RAISE EXCEPTION 'wallet_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- (c) Concurrency limit, counted under the same lock so parallel calls
  -- cannot each observe "one slot free".
  SELECT p.plan INTO v_plan FROM profiles p WHERE p.clerk_user_id = p_user_id;
  SELECT l.max_concurrent_generations INTO v_limit
    FROM plan_limits l WHERE l.plan = COALESCE(v_plan, 'free');
  v_limit := COALESCE(v_limit, 1);

  SELECT count(*) INTO v_active
  FROM credit_reservations
  WHERE clerk_user_id = p_user_id AND status = 'held';

  IF v_active >= v_limit THEN
    RAISE EXCEPTION 'concurrency_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  -- (d) Affordability, checked against the locked value.
  IF v_wallet.balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001';
  END IF;

  v_new_balance := v_wallet.balance - p_amount;

  UPDATE credit_wallets
  SET balance = v_new_balance,
      reserved = reserved + p_amount
  WHERE clerk_user_id = p_user_id;

  -- Read-only mirror kept in sync so existing UI queries keep working.
  UPDATE profiles SET credits = v_new_balance WHERE clerk_user_id = p_user_id;

  INSERT INTO credit_reservations
    (clerk_user_id, generation_id, idempotency_key, amount, quote)
  VALUES
    (p_user_id, p_generation_id, p_idempotency_key, p_amount, COALESCE(p_quote, '{}'::jsonb))
  RETURNING id INTO v_reservation;

  INSERT INTO credit_ledger
    (clerk_user_id, entry_type, amount, balance_after, reservation_id, generation_id)
  VALUES
    (p_user_id, 'reserve', -p_amount, v_new_balance, v_reservation, p_generation_id);

  RETURN jsonb_build_object(
    'reservation_id', v_reservation,
    'generation_id',  p_generation_id,
    'amount',         p_amount,
    'balance',        v_new_balance,
    'status',         'held',
    'replayed',       false
  );
EXCEPTION
  WHEN unique_violation THEN
    -- A true concurrent duplicate raced past the idempotency check above
    -- before either committed. The unique index on
    -- (clerk_user_id, idempotency_key) is what actually decided the race;
    -- this handler just reports its outcome gracefully instead of letting
    -- a raw constraint error reach the caller. Everything this invocation
    -- did (including the wallet decrement above) is rolled back
    -- automatically before this handler runs.
    SELECT * INTO v_existing
    FROM credit_reservations
    WHERE clerk_user_id = p_user_id AND idempotency_key = p_idempotency_key;

    RETURN jsonb_build_object(
      'reservation_id', v_existing.id,
      'generation_id',  v_existing.generation_id,
      'amount',         v_existing.amount,
      'status',         v_existing.status,
      'replayed',       true
    );
END;
$$;

ALTER FUNCTION "public"."reserve_credits"("text", integer, "text", "uuid", "jsonb") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- 7. settle_reservation() — the generation succeeded
-- ---------------------------------------------------------------------------
-- Settling does NOT touch `balance`: the credits already left it at reserve
-- time. It only releases the `reserved` hold and writes the audit entry. This
-- is why refunds are cheap and correct — nothing has to be "taken back", the
-- money simply never returns.
--
-- If the provider reported a smaller real cost, p_actual_amount refunds the
-- difference, so an over-quote is returned to the user automatically.
CREATE OR REPLACE FUNCTION "public"."settle_reservation"(
    "p_reservation_id" "uuid",
    "p_actual_amount" integer DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_res         record;
  v_wallet      record;
  v_actual      integer;
  v_diff        integer;
  v_new_balance integer;
BEGIN
  SELECT * INTO v_res FROM credit_reservations
  WHERE id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Terminal states are idempotent: a retried settle is a no-op, not a
  -- second deduction.
  IF v_res.status <> 'held' THEN
    RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status, 'replayed', true);
  END IF;

  v_actual := LEAST(COALESCE(p_actual_amount, v_res.amount), v_res.amount);
  v_diff   := v_res.amount - v_actual;

  SELECT * INTO v_wallet FROM credit_wallets
  WHERE clerk_user_id = v_res.clerk_user_id FOR UPDATE;

  v_new_balance := v_wallet.balance + v_diff;

  UPDATE credit_wallets
  SET reserved = GREATEST(reserved - v_res.amount, 0),
      balance = v_new_balance,
      lifetime_spent = lifetime_spent + v_actual
  WHERE clerk_user_id = v_res.clerk_user_id;

  UPDATE profiles SET credits = v_new_balance WHERE clerk_user_id = v_res.clerk_user_id;

  UPDATE credit_reservations
  SET status = 'settled', settled_at = now(), amount = v_actual
  WHERE id = v_res.id;

  INSERT INTO credit_ledger
    (clerk_user_id, entry_type, amount, balance_after, reservation_id, generation_id, metadata)
  VALUES
    (v_res.clerk_user_id, 'settle', 0, v_new_balance, v_res.id, v_res.generation_id,
     jsonb_build_object('quoted', v_res.amount, 'actual', v_actual));

  -- An over-quote returned to the user is recorded as a real refund so the
  -- ledger sum still reconciles with the wallet.
  IF v_diff > 0 THEN
    INSERT INTO credit_ledger
      (clerk_user_id, entry_type, amount, balance_after, reservation_id, generation_id, metadata)
    VALUES
      (v_res.clerk_user_id, 'refund', v_diff, v_new_balance, v_res.id, v_res.generation_id,
       jsonb_build_object('reason', 'overquote_returned'));
  END IF;

  RETURN jsonb_build_object(
    'reservation_id', v_res.id, 'status', 'settled',
    'charged', v_actual, 'returned', v_diff, 'balance', v_new_balance
  );
END;
$$;

ALTER FUNCTION "public"."settle_reservation"("uuid", integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- 8. refund_reservation() — the generation failed, was cancelled, or expired
-- ---------------------------------------------------------------------------
-- This is the function that makes "my credits vanished and I got nothing"
-- impossible. Any terminal failure path — provider error, timeout, user
-- cancel, reaper — ends here, and the hold returns to spendable balance.
CREATE OR REPLACE FUNCTION "public"."refund_reservation"(
    "p_reservation_id" "uuid",
    "p_reason" "text" DEFAULT 'generation_failed'
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_res         record;
  v_wallet      record;
  v_new_balance integer;
BEGIN
  SELECT * INTO v_res FROM credit_reservations
  WHERE id = p_reservation_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_res.status <> 'held' THEN
    RETURN jsonb_build_object('reservation_id', v_res.id, 'status', v_res.status, 'replayed', true);
  END IF;

  SELECT * INTO v_wallet FROM credit_wallets
  WHERE clerk_user_id = v_res.clerk_user_id FOR UPDATE;

  v_new_balance := v_wallet.balance + v_res.amount;

  UPDATE credit_wallets
  SET balance = v_new_balance,
      reserved = GREATEST(reserved - v_res.amount, 0)
  WHERE clerk_user_id = v_res.clerk_user_id;

  UPDATE profiles SET credits = v_new_balance WHERE clerk_user_id = v_res.clerk_user_id;

  UPDATE credit_reservations
  SET status = CASE WHEN p_reason = 'expired' THEN 'expired' ELSE 'refunded' END,
      settled_at = now()
  WHERE id = v_res.id;

  INSERT INTO credit_ledger
    (clerk_user_id, entry_type, amount, balance_after, reservation_id, generation_id, metadata)
  VALUES
    (v_res.clerk_user_id, 'refund', v_res.amount, v_new_balance, v_res.id, v_res.generation_id,
     jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object(
    'reservation_id', v_res.id, 'status', 'refunded',
    'returned', v_res.amount, 'balance', v_new_balance
  );
END;
$$;

ALTER FUNCTION "public"."refund_reservation"("uuid", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- 9. grant_credits() — purchases, promos, and chargeback clawback
-- ---------------------------------------------------------------------------
-- Used by the Stripe webhook (positive) and by dispute handling (negative).
-- p_external_ref is the Stripe event/charge id and is what makes the whole
-- function idempotent: Stripe retries webhooks, and a retried payment must
-- not grant credits twice.
--
-- Clawback is allowed to drive the balance to zero but never below it: the
-- user cannot be pushed into debt by a dispute, while the platform still
-- recovers whatever is left. The gap is recorded in metadata so a real loss
-- stays visible instead of silently disappearing.
--
-- REVIEW FIX 1 + 3 (see header): credit_ledger_external_ref_type_uniq is the
-- new database-level backstop for the idempotency check below, and the
-- EXCEPTION handler turns a true concurrent duplicate (both callers pass the
-- initial check before either commits) into the same graceful replayed
-- response the normal idempotency-hit path returns, instead of a raw error —
-- exactly mirroring the fix applied to reserve_credits() above.
CREATE OR REPLACE FUNCTION "public"."grant_credits"(
    "p_user_id" "text",
    "p_amount" integer,
    "p_entry_type" "text",
    "p_external_ref" "text" DEFAULT NULL,
    "p_metadata" "jsonb" DEFAULT '{}'::"jsonb"
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_wallet      record;
  v_new_balance integer;
  v_applied     integer;
  v_shortfall   integer := 0;
BEGIN
  IF p_entry_type NOT IN ('purchase','grant','chargeback','expire','admin_adjust') THEN
    RAISE EXCEPTION 'invalid_entry_type' USING ERRCODE = '22023';
  END IF;

  -- Idempotency for webhook retries.
  IF p_external_ref IS NOT NULL AND EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE external_ref = p_external_ref AND entry_type = p_entry_type
  ) THEN
    SELECT balance INTO v_new_balance FROM credit_wallets WHERE clerk_user_id = p_user_id;
    RETURN jsonb_build_object('balance', v_new_balance, 'replayed', true);
  END IF;

  INSERT INTO credit_wallets (clerk_user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (clerk_user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM credit_wallets
  WHERE clerk_user_id = p_user_id FOR UPDATE;

  v_applied := p_amount;

  IF p_amount < 0 AND (v_wallet.balance + p_amount) < 0 THEN
    v_shortfall := abs(v_wallet.balance + p_amount);
    v_applied := -v_wallet.balance;
  END IF;

  v_new_balance := v_wallet.balance + v_applied;

  UPDATE credit_wallets
  SET balance = v_new_balance,
      lifetime_granted = lifetime_granted + GREATEST(v_applied, 0)
  WHERE clerk_user_id = p_user_id;

  UPDATE profiles SET credits = v_new_balance WHERE clerk_user_id = p_user_id;

  INSERT INTO credit_ledger
    (clerk_user_id, entry_type, amount, balance_after, external_ref, metadata)
  VALUES
    (p_user_id, p_entry_type, v_applied, v_new_balance, p_external_ref,
     COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('unrecovered', v_shortfall));

  RETURN jsonb_build_object(
    'balance', v_new_balance, 'applied', v_applied,
    'unrecovered', v_shortfall, 'replayed', false
  );
EXCEPTION
  WHEN unique_violation THEN
    -- A true concurrent duplicate webhook delivery raced past the
    -- idempotency check above before either committed.
    -- credit_ledger_external_ref_type_uniq is what actually decided the
    -- race; everything this invocation did (including the wallet update
    -- above) is rolled back automatically before this handler runs.
    SELECT balance INTO v_new_balance FROM credit_wallets WHERE clerk_user_id = p_user_id;
    RETURN jsonb_build_object('balance', v_new_balance, 'replayed', true);
END;
$$;

ALTER FUNCTION "public"."grant_credits"("text", integer, "text", "text", "jsonb") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- 10. expire_stale_reservations() — the safety net
-- ---------------------------------------------------------------------------
-- Called on a schedule (Trigger.dev). Without it, a worker that dies mid-flight
-- leaves credits held forever: the user is not charged, but cannot spend them
-- either, and the concurrency slot stays occupied. Both look like "the site is
-- broken" to the user.
CREATE OR REPLACE FUNCTION "public"."expire_stale_reservations"(
    "p_limit" integer DEFAULT 100
) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row   record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id FROM credit_reservations
    WHERE status = 'held' AND expires_at < now()
    ORDER BY expires_at
    LIMIT p_limit
  LOOP
    PERFORM refund_reservation(v_row.id, 'expired');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

ALTER FUNCTION "public"."expire_stale_reservations"(integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- 11. RLS AND GRANTS — money tables are server-only
-- ---------------------------------------------------------------------------
-- RLS is enabled on all three money tables. Wallet and ledger get a
-- read-only SELECT policy so the user can see their own balance and history;
-- there is deliberately NO insert/update/delete policy for `authenticated`,
-- because every write must go through the audited functions above.
--
-- credit_reservations gets no policy at all: it is internal execution state,
-- exactly like generation_attempts.
ALTER TABLE "public"."credit_wallets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."plan_limits" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'credit_wallets_select_own') THEN
    CREATE POLICY "credit_wallets_select_own" ON "public"."credit_wallets"
      FOR SELECT TO "authenticated"
      USING (("clerk_user_id" = (SELECT ("auth"."jwt"() ->> 'sub'::"text"))));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'credit_ledger_select_own') THEN
    CREATE POLICY "credit_ledger_select_own" ON "public"."credit_ledger"
      FOR SELECT TO "authenticated"
      USING (("clerk_user_id" = (SELECT ("auth"."jwt"() ->> 'sub'::"text"))));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'plan_limits_select_all') THEN
    CREATE POLICY "plan_limits_select_all" ON "public"."plan_limits"
      FOR SELECT TO "authenticated" USING (true);
  END IF;
END $$;

GRANT ALL ON TABLE "public"."credit_wallets" TO "service_role";
GRANT ALL ON TABLE "public"."credit_reservations" TO "service_role";
GRANT ALL ON TABLE "public"."credit_ledger" TO "service_role";
GRANT ALL ON TABLE "public"."plan_limits" TO "service_role";

GRANT SELECT ON TABLE "public"."credit_wallets" TO "authenticated";
GRANT SELECT ON TABLE "public"."credit_ledger" TO "authenticated";
GRANT SELECT ON TABLE "public"."plan_limits" TO "authenticated";

-- FUNCTION EXECUTION IS SERVER-ONLY.
-- This is the point of the whole design: the browser cannot call the money
-- functions at all. Even though they are SECURITY DEFINER, EXECUTE is revoked
-- from anon/authenticated, so the only caller is the service-role API route
-- that has already verified the Clerk session and computed the price itself.
REVOKE ALL ON FUNCTION "public"."reserve_credits"("text", integer, "text", "uuid", "jsonb") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."settle_reservation"("uuid", integer) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."refund_reservation"("uuid", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."grant_credits"("text", integer, "text", "text", "jsonb") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."expire_stale_reservations"(integer) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."reserve_credits"("text", integer, "text", "uuid", "jsonb") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."settle_reservation"("uuid", integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."refund_reservation"("uuid", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."grant_credits"("text", integer, "text", "text", "jsonb") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."expire_stale_reservations"(integer) TO "service_role";


-- ---------------------------------------------------------------------------
-- 12. RECONCILIATION VIEW — detect drift before it becomes an invoice
-- ---------------------------------------------------------------------------
-- The ledger and the wallet must always agree. When they do not, something is
-- wrong in a money path, and that is worth an alert rather than a discovery
-- weeks later. A scheduled job selects rows WHERE NOT ok.
--
-- THE TWO INVARIANTS CHECKED HERE:
--
--   (1) SUM(ledger) = balance
--       A 'reserve' entry debits the ledger by the held amount at the same
--       moment the wallet balance is decremented, so the two stay equal while
--       a generation is in flight. Settling writes a zero-amount audit entry
--       (the credits were already deducted), and refunding writes a positive
--       entry that mirrors the balance being restored. Any inequality means a
--       money path wrote one side without the other — a real bug.
--
--   (2) wallet.reserved = SUM(held reservations)
--       These are maintained by different writes: a counter on the wallet row
--       versus the reservation rows themselves. Comparing them independently
--       is what localises WHICH path drifted, instead of only revealing that
--       something is wrong.
CREATE OR REPLACE VIEW "public"."credit_reconciliation" AS
SELECT
  w."clerk_user_id",
  w."balance"                            AS wallet_balance,
  w."reserved"                           AS wallet_reserved,
  COALESCE(l."ledger_sum", 0)::integer   AS ledger_sum,
  COALESCE(h."live_holds", 0)::integer   AS live_holds,
  (COALESCE(l."ledger_sum", 0) = w."balance")
    AND (w."reserved" = COALESCE(h."live_holds", 0))   AS ok
FROM "public"."credit_wallets" w
LEFT JOIN (
  SELECT "clerk_user_id", SUM("amount") AS "ledger_sum"
  FROM "public"."credit_ledger" GROUP BY "clerk_user_id"
) l ON l."clerk_user_id" = w."clerk_user_id"
LEFT JOIN (
  SELECT "clerk_user_id", SUM("amount") AS "live_holds"
  FROM "public"."credit_reservations" WHERE "status" = 'held'
  GROUP BY "clerk_user_id"
) h ON h."clerk_user_id" = w."clerk_user_id";

ALTER VIEW "public"."credit_reconciliation" OWNER TO "postgres";

REVOKE ALL ON TABLE "public"."credit_reconciliation" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT ON TABLE "public"."credit_reconciliation" TO "service_role";
