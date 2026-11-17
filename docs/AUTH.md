# AUTH.md — demonstration identity system

**Read this before touching `assets/js/accounts.js`, `assets/js/auth.js` or `index.html`.**

## What this is

MediHeal runs as a static site on GitHub Pages with no server. Authentication is therefore
**simulated in the browser** so that each of the 14 demo roles can sign in as a distinct person
instead of picking a role from a dropdown.

**It is not secure, and it must never be described as secure.** Everything below lives in
`localStorage`/`sessionStorage` on a public URL and is readable and writable by anyone who opens
devtools. Hiding a button or a route is not access control.

## Accounts

Seeded once into `mh_accounts` on first load by `assets/js/accounts.js`.

| Field | Meaning |
|---|---|
| `id` | `USR-0001` … unique, sequential |
| `email` | Login identity. Normalised with `trim().toLowerCase()` before any match. |
| `name` / `title` / `dept` | Display identity shown in the header and account menu |
| `role` | One of the 14 keys in `HIS.rbac.ROLES` — the single source of the user's permissions |
| `status` | `active` or `disabled`; disabled accounts are refused at sign-in and mid-session |
| `verifier` | Digest of the password. **Not a password hash** — see below. |
| `createdAt` / `lastLogin` | ISO timestamps |
| `resetRequired` | Set when an administrator resets the password |
| `patientId` | Links the patient account to a hospital record (M5) |
| `seeded` | Marks the 14 original accounts |

### Demo credentials

Every seeded account shares the public demo password **`MediHeal2026!`**.
Emails use the reserved `.test` TLD — they are login identities only, not real mailboxes.

```
superadmin@mediheal.test      admin@mediheal.test           reception@mediheal.test
admissions@mediheal.test      doctor@mediheal.test          nurse@mediheal.test
pharmacy@mediheal.test        laboratory@mediheal.test      cashier@mediheal.test
finance@mediheal.test         hr@mediheal.test              department.head@mediheal.test
auditor@mediheal.test         patient@mediheal.test
```

### The password verifier is not a hash

`digest()` is FNV-1a applied twice — fast, unsalted, no work factor. It exists so the stored record
does not contain a literal plaintext password. It provides **no** protection against an attacker who
can read storage: they can brute-force it instantly, and they can also just write their own session.

## Sessions

`assets/js/auth.js`.

| "Keep me signed in" | Storage | Lifetime |
|---|---|---|
| checked | `localStorage.mh_session` | 30 days |
| unchecked | `sessionStorage.mh_session_tab` | 12 hours, dies with the tab |

Either way a plain refresh keeps the session, which is what users expect. `expiresAt` is checked on
every read, so an expired session is treated as no session.

Session shape:

```json
{ "userId": "USR-0005", "email": "doctor@mediheal.test", "role": "doctor",
  "at": "2026-11-17T14:20:00.000Z", "expiresAt": "2026-11-18T02:20:00.000Z", "remember": false }
```

The session is **not** a signed token. Editing `role` in it does nothing, because the role is always
re-read from the account record (`HIS.auth.account()` → `HIS.accounts.byId()`), and a missing or
disabled account resolves to no session at all.

## Route guard

`HIS.rbac.guard()` runs at the top of `mountShell()` in `assets/js/shell.js`, before any page script:

1. `HIS.auth.requireAuth()` — no valid session → `index.html?next=<page>`.
2. `HIS.rbac.allows(stem)` — role may not open this page → redirect to the role's home.

`index.html` and `portal.html` do not load `shell.js` and are public.

## Password recovery

There is **no email**. A static site cannot send mail, and the previous "reset link sent" screen
was removed because it asserted something untrue.

What the demo does instead:

- The sign-in screen's *Forgot password?* explains the limitation and offers the demo-account list.
- A Super Administrator can reset any account's password from **Accounts**.
- The reset is audited; the password itself never is.

## Account management

`accounts.html` (Super Administrator only) — create, edit, change role/department, activate,
deactivate, reset password, review last sign-in. Guard rails:

- Emails are unique and case-insensitive; duplicates are refused.
- Roles are validated against the registry.
- The **last active Super Administrator** cannot be demoted or deactivated.
- There is no delete: accounts are deactivated, so history stays attributable.

## What real deployment would need

Replace `accounts.js` + `auth.js` with a server-side identity service:

1. Store passwords as **Argon2id** (or bcrypt) hashes with a per-user salt, server-side only.
2. Verify credentials over HTTPS and issue an **HttpOnly, Secure, SameSite=Lax** session cookie —
   never a value the browser can read or forge.
3. Rate-limit and lock out after repeated failures; log attempts server-side.
4. Implement real email verification and time-limited, single-use reset tokens.
5. Enforce roles and permissions **on the server** for every request; the client-side `rbac.js`
   becomes presentation only.
6. Add CSRF protection, a Content-Security-Policy, and session revocation on password change.
7. Keep PHI server-side under a signed data-processing agreement — never in a public static bundle.

## Related

- `docs/DESIGN-LOCK.md` — the visual contract the sign-in screen must keep.
- `docs/GITHUBPROGRESS-session28-addendum.md` — what M3 actually changed and how it was verified.
- `scripts/auth-check.mjs` — 25 assertions covering the flows above.
