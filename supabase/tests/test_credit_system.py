# Cinefield credit system — local validation test (Phase 10).
#
# Runs entirely against an EPHEMERAL local Postgres started by pgserver.
# Never connects to production/staging Supabase. Safe to run repeatedly.
#
# Prerequisites (not installed in this repo's own toolchain — Python, not
# Node):
#   pip install pgserver psycopg2-binary
#
# The ephemeral database must already have this migration (and its
# prerequisites: profiles, generations, set_updated_at()) applied before
# running this file — point pgserver at a data directory that has run
# `supabase db reset` (or equivalent) against the full migrations/ folder,
# or apply 20260805132704_remote_schema.sql, 20260810120000_generation_attempts.sql
# and 20260811120000_credit_system.sql in order first.
#
# Usage:
#   python supabase/tests/test_credit_system.py

import pgserver, psycopg2, threading, itertools

db = pgserver.get_server('/home/claude/pgdata')
URI = db.get_uri()
_ids = itertools.count(1)

def q(sql, args=None, fetch=False, role=None, jwt=None):
    c = psycopg2.connect(URI); c.autocommit = True; cur = c.cursor()
    if jwt: cur.execute("SET request.jwt.claims = %s", ('{"sub":"%s"}' % jwt,))
    if role: cur.execute(f"SET ROLE {role}")
    cur.execute(sql, args)
    r = cur.fetchall() if fetch else None
    c.close(); return r

def new_user(bal=100, plan='pro'):
    """Fresh user per test: the ledger is append-only by design, so tests
    cannot delete history — they use a new identity instead."""
    uid = f"user_{next(_ids)}"
    q("INSERT INTO profiles (clerk_user_id, credits, plan) VALUES (%s,0,%s)", (uid, plan))
    # Fund through the real money path (as Stripe/webhook would), so the
    # ledger has a matching entry and the reconciliation invariant holds.
    if bal:
        q("SELECT grant_credits(%s,%s,'grant',%s)", (uid, bal, f'seed_{uid}'))
    else:
        q("INSERT INTO credit_wallets (clerk_user_id, balance) VALUES (%s,0)", (uid,))
    return uid

def bal_of(uid):
    return q("SELECT balance, reserved FROM credit_wallets WHERE clerk_user_id=%s", (uid,), fetch=True)[0]

passed = failed = 0
def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print(f"  PASS  {name}  {detail}")
    else:    failed += 1; print(f"  FAIL  {name}  {detail}")

print("\n=== A. YETKI / PRIVILEGE ===")
u = new_user()
try:
    c = psycopg2.connect(URI); c.autocommit=True; cur=c.cursor()
    cur.execute("SET request.jwt.claims = %s", ('{"sub":"%s"}' % u,))
    cur.execute("SET ROLE authenticated")
    cur.execute(f"UPDATE profiles SET credits=999999 WHERE clerk_user_id='{u}'")
    blocked = False
except Exception:
    blocked = True
check("Kullanici kendi kredisini yazamaz", blocked)

try:
    c = psycopg2.connect(URI); c.autocommit=True; cur=c.cursor()
    cur.execute("SET request.jwt.claims = %s", ('{"sub":"%s"}' % u,))
    cur.execute("SET ROLE authenticated")
    cur.execute(f"UPDATE profiles SET display_name='Hakan' WHERE clerk_user_id='{u}'")
    ok = True
except Exception:
    ok = False
check("Kullanici display_name'ini degistirebilir", ok)

try:
    c = psycopg2.connect(URI); c.autocommit=True; cur=c.cursor()
    cur.execute("SET ROLE authenticated")
    cur.execute(f"SELECT reserve_credits('{u}',5,'idem-aaaaaaaa')")
    blocked2 = False
except Exception:
    blocked2 = True
check("Tarayici para fonksiyonunu cagiramaz", blocked2)

print("\n=== B. YARIS DURUMU (RACE) — reserve_credits ===")
u = new_user(bal=10)
res = []
lk = threading.Lock()
def attack(i):
    try:
        q(f"SELECT reserve_credits('{u}',10,'race-key-{i}-aaaa')")
        with lk: res.append(1)
    except Exception:
        with lk: res.append(0)
ts = [threading.Thread(target=attack, args=(i,)) for i in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
b = bal_of(u)
check("4 es zamanli istek, 10 kredi -> tek uretim", sum(res)==1 and b[0]==0,
      f"(gecen={sum(res)}, bakiye={b[0]})")

print("\n=== B2. YARIS DURUMU (RACE) — grant_credits, AYNI idempotency key ===")
# REVIEW FIX validation: before credit_ledger_external_ref_type_uniq existed,
# this test would have been able to double-grant credits under a true race —
# Test C below only proves SEQUENTIAL idempotency, which was never the gap.
u = new_user(bal=0)
res2 = []
def webhook_retry(_i):
    try:
        q(f"SELECT grant_credits('{u}',500,'purchase','evt_dupe_{u}')")
        with lk: res2.append(1)
    except Exception:
        with lk: res2.append(0)
ts2 = [threading.Thread(target=webhook_retry, args=(i,)) for i in range(6)]
[t.start() for t in ts2]; [t.join() for t in ts2]
b2 = bal_of(u)
check("6 es zamanli ayni Stripe webhook -> tek kredi yuklemesi", b2[0]==500,
      f"(basarili_cagri={sum(res2)}, bakiye={b2[0]}, beklenen=500)")

print("\n=== C. IDEMPOTENCY (sequential) ===")
u = new_user()
q(f"SELECT reserve_credits('{u}',10,'same-key-12345678')")
r2 = q(f"SELECT reserve_credits('{u}',10,'same-key-12345678')", fetch=True)[0][0]
check("Cift tiklama tek ucret", bal_of(u)[0]==90 and r2.get('replayed'), f"(bakiye={bal_of(u)[0]})")
check("Replay cevabi generation_id iceriyor (REVIEW FIX)", 'generation_id' in r2, f"(anahtarlar={list(r2.keys())})")

print("\n=== D. CONCURRENCY LIMITI ===")
u = new_user(bal=1000, plan='free')
res = []
def go(i):
    try: q(f"SELECT reserve_credits('{u}',10,'conc-key-{i}-aaaa')"); res.append(1)
    except Exception: res.append(0)
ts = [threading.Thread(target=go, args=(i,)) for i in range(5)]
[t.start() for t in ts]; [t.join() for t in ts]
check("Free plan: 5 istekten 1'i gecer", sum(res)==1, f"(gecen={sum(res)})")

print("\n=== E. PARA AKISI ===")
u = new_user()
rid = q(f"SELECT reserve_credits('{u}',30,'refund-key-1234')", fetch=True)[0][0]['reservation_id']
q("SELECT refund_reservation(%s,'provider_failed')", (rid,))
b = bal_of(u)
check("Provider hatasinda tam iade", b[0]==100 and b[1]==0, f"(bakiye={b[0]}, reserved={b[1]})")

u = new_user()
rid = q(f"SELECT reserve_credits('{u}',30,'settle-key-1234')", fetch=True)[0][0]['reservation_id']
q("SELECT settle_reservation(%s)", (rid,))
b = bal_of(u)
check("Basarili uretim krediyi harcar", b[0]==70 and b[1]==0, f"(bakiye={b[0]})")

u = new_user()
rid = q(f"SELECT reserve_credits('{u}',30,'over-key-123456')", fetch=True)[0][0]['reservation_id']
q("SELECT settle_reservation(%s,18)", (rid,))
check("Fazla tahmin iade edilir", bal_of(u)[0]==82, f"(bakiye={bal_of(u)[0]}, beklenen 82)")

u = new_user()
rid = q(f"SELECT reserve_credits('{u}',30,'dbl-key-1234567')", fetch=True)[0][0]['reservation_id']
q("SELECT settle_reservation(%s)", (rid,)); q("SELECT settle_reservation(%s)", (rid,))
check("Tekrarlanan settle ikinci kez dusmez", bal_of(u)[0]==70, f"(bakiye={bal_of(u)[0]})")

print("\n=== F. LEDGER / ODEME ===")
u = new_user()
q(f"SELECT reserve_credits('{u}',10,'ledger-key-1234')")
try: q(f"UPDATE credit_ledger SET amount=-99999 WHERE clerk_user_id='{u}'"); imm=False
except Exception: imm=True
check("Ledger degistirilemez (append-only)", imm)

u = new_user(bal=0)
q(f"SELECT grant_credits('{u}',500,'purchase','evt_stripe_{u}')")
q(f"SELECT grant_credits('{u}',500,'purchase','evt_stripe_{u}')")
check("Stripe webhook tekrari cift kredi yuklemez (sequential)", bal_of(u)[0]==500, f"(bakiye={bal_of(u)[0]})")

q(f"SELECT grant_credits('{u}',-800,'chargeback','dp_{u}')")
unrec = q("SELECT metadata->>'unrecovered' FROM credit_ledger WHERE entry_type='chargeback' AND clerk_user_id=%s",(u,),fetch=True)[0][0]
check("Chargeback eksiye dusurmez", bal_of(u)[0]==0 and unrec=='300',
      f"(bakiye={bal_of(u)[0]}, tahsil edilemeyen={unrec})")

print("\n=== G. GUVENLIK AGI ===")
u = new_user()
rid = q(f"SELECT reserve_credits('{u}',40,'expire-key-1234')", fetch=True)[0][0]['reservation_id']
q("UPDATE credit_reservations SET expires_at=now()-interval '1 hour' WHERE id=%s", (rid,))
n = q("SELECT expire_stale_reservations(10)", fetch=True)[0][0]
check("Kayip isin kredisi geri doner", bal_of(u)[0]==100, f"({n} rezervasyon kurtarildi)")

u = new_user()
q(f"SELECT reserve_credits('{u}',25,'mirror-key-1234')")
p = q("SELECT credits FROM profiles WHERE clerk_user_id=%s",(u,),fetch=True)[0][0]
check("profiles.credits aynasi senkron", bal_of(u)[0]==p==75, f"(wallet={bal_of(u)[0]}, profile={p})")

bad = q("SELECT count(*) FROM credit_reconciliation WHERE NOT ok", fetch=True)[0][0]
check("TUM kullanicilarda ledger=cuzdan", bad==0, f"(uyumsuz: {bad})")

print(f"\n{'='*46}\nSONUC: {passed} PASS / {failed} FAIL\n{'='*46}")
