# Supabase

The site runs with **no backend at all** unless two values are filled in. This document covers the
schema, the rules the database enforces, how the browser talks to it, and how to verify the whole
path.

---

## 1. What it adds

| Layer | Before | With Supabase |
|---|---|---|
| Where records live | `sessionStorage` in one tab | Postgres rows owned by one anonymous identity |
| New tab / new device | empty demonstration | the same visitor's records |
| Two people at once | isolated tabs | isolated, because every row is scoped by `auth.uid()` |
| History | rewritten with the store | `audit_log`, append-only, enforced by trigger |
| Money | one browser's ledger | `ledger_transactions`, with a unique idempotency index |

The application's own rules are untouched: `HIS.ledger` still owns money, `HIS.registry` still owns
patients, and no module was rewritten to fit the database. The adapter sits on the single boundary
those modules already share (`HIS.store`).

---

## 2. Setup (5 minutes)

1. Create a project at <https://supabase.com/dashboard>. Copy **Project URL** and the
   **anon/publishable key** (Settings → API).
2. **Authentication → Providers → Anonymous**: enable it. The client signs in anonymously, which is
   what gives every visitor a real `auth.uid()`; without this switch the policies deny everything.
   Turn **off** "Confirm email" for demo use if it is offered for anonymous users.
3. **SQL Editor** → paste `supabase/migrations/0001_init.sql` → Run. It is idempotent.
4. Edit `assets/js/supabase-config.js`:

   ```js
   window.MEDIHEAL_SUPABASE = {
     url: 'https://<project-ref>.supabase.co',
     key: '<anon publishable key>'
   };
   ```

   The anon key is public by design. A `service_role` key must never appear in this file.
5. Open the site, sign in once. `HIS.db.status()` in the console should report
   `{ configured: true, ready: true, mode: 'connected' }`.

Leaving either value empty keeps the site exactly as it is today: the CDN script loads, the adapter
disables itself, all writes stay in `sessionStorage`.

---

## 3. The data model

Typed columns exist for anything a report, index or sort needs. The complete record is also kept in
`data jsonb`, so a column that is not listed never means lost data.

| Table | Source in the app | Notes |
|---|---|---|
| `patients` | `mh_patients` (`HIS.registry`) | MRN in `id`; `last_name`, `dob`, `mobile`, `attention` indexed for duplicate review |
| `registrations` | `mh_regs_extra` | rows minted by the two registration forms |
| `appointments` | `mh_appts_extra` | `slot_at` indexed for the day view |
| `encounters` | `mh_encounters` | the episode a charge hangs from |
| `charges` | `mh_charges` | `amount` numeric, `status` unbilled → invoiced → void |
| `invoices` | `mh_invoices` | header only; **no balance column**, on purpose |
| `ledger_transactions` | `mh_tx` | centavos in the app → pesos in the column; unique `(owner_id, idempotency_key)` |
| `claims` | `mh_claims` | payer workflow rows |
| `admissions` | `mh_admissions` | ward/bed indexed for the bed board |
| `lab_orders`, `prescriptions`, `stock_batches` | `mh_lab`, `mh_rx`, `mh_stock` | clinical and pharmacy |
| `personnel`, `guardians` | `mh_personnel`, `mh_guardians` | roster and account↔patient links |
| `module_state` | every other `mh_*` key | one JSON document per key: payroll runs, attendance register, tariffs, notification flags, treatment/nursing/consultation state |
| `audit_log` | `mh_audit` | append-only history |

Two deliberate refusals:

- **No balance is stored.** A balance is the sum of `ledger_transactions`, which is the rule
  `HIS.ledger` already enforces locally. A second number would eventually disagree with the first.
- **No credentials are stored.** `mh_accounts` and the session never leave the browser
  (`LOCAL_ONLY` in `assets/js/db.js`). The demonstration passwords are not real secrets, but copying
  them into a database would suggest the site had an identity system it does not have.

---

## 4. Rules the database enforces

`0001_init.sql` turns on RLS, **forces** it on every table, and grants exactly four verbs scoped to
the row owner:

```sql
using (owner_id = (select auth.uid()))
```

- No policy mentions `anon`: a request without an anonymous session matches nothing.
- `audit_log` has no UPDATE or DELETE policy, and a trigger raises on both, so history cannot be
  rewritten even by a privileged role.
- A retried payment cannot double-post: `(owner_id, idempotency_key)` is unique, so the second
  insert fails instead of inflating the ledger.

What this is **not**: the demo login is client-side, so page access is still a UI allowlist. RLS
protects the *rows*, not the routes. Making the routes truthful needs Supabase Auth email/password
replacing `HIS.auth.attempt` — a separate, larger change that this migration does not pretend to
have made.

---

## 5. How the browser uses it

`assets/js/db.js`, loaded on every page after `store.js`:

1. `HIS.db.bootstrap()` — called once at sign-in (staff and patient portal). Reuses a stored
   anonymous session or creates one, then hydrates the local stores from the server. Sign-in never
   waits on it: a 2.5 s ceiling applies, then the workspace opens regardless.
2. Every `HIS.store.set()` is mirrored afterwards: row arrays diff by `id` (upsert changed, delete
   removed), documents upsert into `module_state`, new audit rows are inserted. Writes are debounced
   500 ms and retried on `online` / tab hide.
3. `HIS.db.status()` → `{ configured, ready, uid, mode, pending, error }`.

Failure is always local-first: if the network, the CDN or the project is unavailable, writes stay in
`sessionStorage` and the site behaves as it did before.

---

## 6. Verifying it

```bash
node scripts/supabase-check.mjs          # schema reachable, policies deny anon, insert/select/audit work
```

The check refuses to run without configuration, and it cleans up every row it creates.

---

## 7. Operations

- **Migrations**: append files as `supabase/migrations/0002_*.sql`, never edit `0001` after it has
  been applied. `supabase db push` works if you install the CLI; the SQL editor is enough otherwise.
- **Backups**: Dashboard → Database → Backups. The free tier keeps daily backups; do not rely on it
  for anything but a demonstration.
- **Rotating the key**: replace it in `supabase-config.js` and redeploy. The anon key is not a
  secret, but rotating it ends every existing anonymous session.
- **Deleting a visitor's data**: delete their `auth.users` row; every table cascades from
  `owner_id` only if you add `on delete cascade` (not included, so rows survive an identity delete
  and must be removed explicitly).

---

## 8. Honest limitations

- Anonymous identities are per browser profile. Clearing storage creates a new, empty identity; the
  old rows remain in the project until deleted.
- The 500-row cap on audit hydration is a demonstration limit, not a retention policy.
- `module_state` is a document store: it is portable and honest, but it does not support
  server-side reporting on payroll or attendance. Normalising those needs their modules changed.
