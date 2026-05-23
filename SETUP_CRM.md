# Bluewater CRM — Setup Guide

This wires up the inbound stack: **Twilio (phone) → Cloudflare Worker → Supabase (tickets) + Resend (email alerts) → /admin dashboard.**

Read top to bottom. Each step takes 5–20 minutes. Total: ~90 minutes.

---

## What you're building

```
┌─────────────┐    ┌─────────────────────┐    ┌──────────────┐
│ Inbound     │    │ Cloudflare Worker   │───▶│ Supabase     │
│ phone call  │───▶│ (bluewater-api)     │    │ tickets      │
└─────────────┘    │                     │    └──────┬───────┘
                   │  /twilio/voice      │           │
                   │  /twilio/recording  │           │ RLS-gated
                   │  /twilio/status     │           │ magic-link
                   │  /forms/readiness   │           ▼
┌─────────────┐    │  /forms/contact     │    ┌──────────────┐
│ Website     │───▶│                     │───▶│ Resend email │
│ forms       │    └─────────────────────┘    │ → hello@...  │
└─────────────┘                                └──────────────┘
                                              ┌──────────────┐
                                              │ /admin/ UI   │
                                              │ (this repo)  │
                                              └──────────────┘
```

---

## 1. Supabase project (10 min)

1. [supabase.com](https://supabase.com) → New project. Name `bluewater-crm`. Region: `eu-west-2 (London)`. Free tier is fine.
2. Wait for it to provision (~2 min).
3. **SQL Editor** → New query → paste the contents of `supabase/migrations/0001_tickets.sql` → Run.
4. **Project Settings → API** — copy these (you'll need them):
   - **Project URL** (e.g. `https://abcdxyz.supabase.co`)
   - **anon / public** key (safe in browser, RLS protects data)
   - **service_role** key (server-side only — the Worker uses this; never expose)
5. **Authentication → URL Configuration**:
   - Site URL: `https://bluewaterassociates.co.uk`
   - Redirect URLs: add `https://bluewaterassociates.co.uk/admin/`
6. **Authentication → Email** — magic-link is on by default. Optional: customise the email template to use Bluewater branding.

---

## 2. Resend (5 min — domain is already verified)

1. [resend.com](https://resend.com) → API Keys → Create new key. Name `bluewater-worker`. Scope: full access (or `emails:send` only).
2. Copy the `re_...` key.
3. Confirm the sending identity `tickets@bluewaterassociates.co.uk` is allowed under your verified domain. If you prefer a different `from` address, edit `ALERT_FROM` in `worker/wrangler.toml`.

---

## 3. Cloudflare Worker (20 min)

1. Install Wrangler (one-off):
   ```
   npm i -g wrangler
   ```
2. Log in:
   ```
   wrangler login
   ```
3. From the `worker/` directory, set secrets (paste values when prompted):
   ```
   cd worker
   wrangler secret put TWILIO_AUTH_TOKEN
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_SERVICE_KEY
   wrangler secret put RESEND_API_KEY
   ```
   `TWILIO_AUTH_TOKEN` will be set in the next step — set a placeholder for now and update after step 4.
4. Edit `wrangler.toml`:
   - Set `TWILIO_PHONE_E164` to the UK number you'll buy in step 4 (E.164 format, e.g. `+441512345678`).
   - Set `FORWARD_TO_E164` to your mobile (e.g. `+447712345678`) — Twilio will ring this before sending the caller to voicemail.
5. Deploy:
   ```
   wrangler deploy
   ```
   Output shows your live URL, e.g. `https://bluewater-api.<account>.workers.dev`.
6. Smoke test:
   ```
   curl https://bluewater-api.<account>.workers.dev/healthz
   ```
   Expect `{"ok":true}`.

### (Optional) Custom subdomain `api.bluewaterassociates.co.uk`

Requires Cloudflare DNS. If you move DNS from GoDaddy to Cloudflare:
1. Add the site to Cloudflare → copy the nameservers → set them at GoDaddy.
2. In `worker/wrangler.toml`, uncomment the `[[routes]]` block.
3. `wrangler deploy` again.

(Skip this for now if you want to keep GoDaddy DNS — the `*.workers.dev` URL works fine.)

---

## 4. Twilio (20 min)

1. [twilio.com](https://twilio.com) → sign up (free trial includes credit).
2. **Phone Numbers → Buy a number** → Country: United Kingdom → Capabilities: Voice (+SMS if you want it) → Buy. Cost: ~£1/month.
3. Copy your **Account SID** and **Auth Token** (Console homepage).
4. Update the Worker:
   ```
   cd worker
   wrangler secret put TWILIO_AUTH_TOKEN   # paste the real token
   ```
5. **Configure the number**:
   - Phone Numbers → Active numbers → click your number
   - Voice Configuration → **A call comes in**:
     - Webhook: `https://bluewater-api.<account>.workers.dev/twilio/voice`
     - HTTP: `POST`
   - Call status changes (Status Callback URL): leave blank — the Worker triggers its own status callback from the TwiML `<Dial action>`.
   - Save.
6. Update `worker/wrangler.toml` → set `TWILIO_PHONE_E164` and `FORWARD_TO_E164` if not done, then `wrangler deploy` again.
7. **Test**: call the Twilio number from another phone. Your mobile should ring. If you decline / don't answer, the caller hears the voicemail prompt. After they leave a message, expect:
   - A ticket appears at `/admin/`
   - An email lands at `hello@bluewaterassociates.co.uk` with the recording URL
   - A second email follows with the transcript (~30 sec later)

---

## 5. Admin dashboard (5 min)

1. Open `admin/index.html` and replace the two constants near the top of the `<script>` block:
   ```js
   const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';   // anon/public key (safe in browser)
   ```
2. Commit + push.
3. Visit `https://bluewaterassociates.co.uk/admin/` → enter your admin email → click the magic link in the email → you're in.

Only emails in the RLS allowlist (`paul@bluewaterassociates.co.uk`, `paulmc18@gmail.com`) can read/update tickets. To add more admins, edit the policy in Supabase SQL editor:
```sql
drop policy "admins read tickets" on tickets;
create policy "admins read tickets" on tickets for select to authenticated
  using (auth.jwt() ->> 'email' in ('paul@...', 'someone@...'));
-- repeat for the update policy
```

---

## 6. Wire the readiness form to the Worker (2 min)

In `readiness.html`, find `WORKER_URL` (one line) and replace `REPLACE_ACCOUNT` with your real Cloudflare account subdomain (or swap the whole URL for `https://api.bluewaterassociates.co.uk` if you set up the custom route). Commit + push.

Submit the form on the live site and confirm:
- A ticket appears at `/admin/`
- An alert email lands at `hello@bluewaterassociates.co.uk`

---

## 7. Add "Call us" to the main site (optional, 1 min)

Once your Twilio number is live and you've added it to the nav/CTAs:
```
href="tel:+441512345678"
```
Search `index.html` for the existing `+44 1234 567890` placeholders and replace with the real Twilio number.

---

## Ongoing operations

- **Where leads land:** `/admin/` is your inbox. Mark tickets **In progress** the moment you pick one up; **Closed** when done. Notes field is your running log.
- **Voicemail recordings** live on Twilio (auto-purge after 30 days unless you change retention). The Worker stores the URL + transcript permanently in the ticket payload.
- **Cost at a glance:**
  - Twilio UK number: ~£1/mo + ~1p/min inbound + ~£0.0025/transcribed minute
  - Cloudflare Workers: free up to 100k requests/day
  - Supabase: free up to 500MB DB + 50k MAU auth
  - Resend: free up to 3,000 emails/month, then £20/mo for 50k
  - **Total floor: ~£1/mo until you scale**

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Twilio call returns "application error" | Worker URL wrong on Twilio, or signature verification failing | Re-check webhook URL; verify `TWILIO_AUTH_TOKEN` secret is current |
| Form submits but no ticket | CORS or Worker URL placeholder still in HTML | Open browser devtools → Network → check the POST response |
| Magic-link email not arriving | Supabase default sender flagged by Microsoft | In Supabase → Auth → SMTP, plug in Resend SMTP credentials |
| `/admin/` shows "Failed to fetch" | Anon key or URL not pasted into `admin/index.html` | Edit, commit, push |
| Email landing in spam | DKIM/DMARC misalignment on the sending domain | Re-verify domain in Resend; check SPF includes Resend |

## Files

| Path | What it does |
|---|---|
| `supabase/migrations/0001_tickets.sql` | Schema + RLS policies |
| `worker/src/index.ts` | The Worker (all 6 routes) |
| `worker/wrangler.toml` | Worker config + non-secret env vars |
| `worker/.dev.vars.example` | Template for local dev secrets |
| `admin/index.html` | Magic-link dashboard at `/admin/` |
| `readiness.html` | Form posts JSON to `/forms/readiness` |
