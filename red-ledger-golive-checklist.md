# The Red Ledger — Go-Live Execution Checklist
## One browser session, ~60 minutes

Work through in order. Each section has a time estimate.

---

## 0. Before you start — have these ready

- [ ] Access to `hello@bluewaterassociates.co.uk` inbox (you'll need to verify it)
- [ ] Cloudflare login for `bluewaterassociates.co.uk` DNS
- [ ] Formspree account login (to connect via Zapier)
- [ ] Bluewater Associates registered address (for PECR footer)
- [ ] Close date for founding member offer (you're setting this manually — pick a date 14–21 days from when you start sending traffic)

---

## 1. MailerLite account (~10 min)

1. Go to **mailerlite.com** → Sign Up Free
2. Use `hello@bluewaterassociates.co.uk` as the sending address
3. Verify the email when prompted
4. When asked for your website: `bluewaterassociates.co.uk`
5. Set sender details:
   - **From name:** `Paul McWilliam — The Red Ledger`
   - **Reply-to:** `hello@bluewaterassociates.co.uk`

---

## 2. DNS — sender authentication (~10 min, then wait)

MailerLite will show you two CNAME records (DKIM) and one TXT record (SPF).

1. Copy each record
2. Log into **Cloudflare DNS** for `bluewaterassociates.co.uk`
3. Add:
   - TXT record for SPF
   - 2 × CNAME records for DKIM
4. Back in MailerLite, click **Verify** — propagation is usually instant on Cloudflare

> If verification fails first time, wait 2 minutes and try again.

---

## 3. Create the subscriber group (~2 min)

1. Left sidebar → **Subscribers** → **Groups**
2. **Create group** → Name: `The Red Ledger — Waitlist`
3. Save

---

## 4. Create the embedded form (~5 min)

This form won't be used directly — you only need the Group connection for the Zapier bridge.
But it's worth creating anyway for manual imports later.

1. Left sidebar → **Forms** → **Embedded forms**
2. **Create embedded form** → Name: `Red Ledger Waitlist Form`
3. Connect to group: `The Red Ledger — Waitlist`
4. Fields:
   - Email (already there)
   - First name (add this)
5. Save

---

## 5. Zapier bridge — Formspree → MailerLite (~5 min)

1. Go to **zapier.com** → create a free account (or log in)
2. **Create Zap**:
   - **Trigger app:** Formspree
   - **Event:** New Submission
   - Connect your Formspree account, select the Red Ledger form (`mwvzyvpe`)
3. **Action app:** MailerLite
   - **Event:** Create/Update Subscriber
   - Field mapping:
     - Email → email
     - Name → first_name (or first name field)
   - **Group:** `The Red Ledger — Waitlist`
4. Test the Zap (it'll fire a test submission through)
5. Turn Zap ON

> Free Zapier = 100 tasks/month. More than enough for validation stage.

---

## 6. Build the automation (~20 min)

1. Left sidebar → **Automations** → **Create automation**
2. Name: `The Red Ledger — 5-Day Challenge`
3. Trigger: **When subscriber joins a group** → `The Red Ledger — Waitlist`

### Add steps in this order:

| Step | Action | Notes |
|------|--------|-------|
| 1 | Send email — Day 0 confirmation | Fires immediately on signup |
| 2 | Delay 1 day | Set send time: 8:00am |
| 3 | Send email — Day 1 | Bookkeeper question |
| 4 | Delay 1 day | 8:00am |
| 5 | Send email — Day 2 | Supplier ledger answer + CE question |
| 6 | Delay 1 day | 8:00am |
| 7 | Send email — Day 3 | CE cert answer + WhatsApp question |
| 8 | Delay 1 day | 8:00am |
| 9 | Send email — Day 4 | WhatsApp answer + ChatGPT question |
| 10 | Delay 1 day | 8:00am |
| 11 | Send email — Day 5 | ChatGPT answer + founding member offer |
| 12 | Delay 2 days | — |
| 13 | Condition | Clicked Day 5 join link? |
| 14 | Send email — Day 7 chase | Non-clickers only |

**Email copy:** all 7 emails are in `red-ledger-mailerlite-setup.md` — Steps 1–14, copy/paste ready.

> Before activating: replace `[CLOSE DATE]` in both Day 5 and Day 7 emails with your actual date.
> Replace `[JOIN AS A FOUNDING MEMBER →]` URL with `https://bluewaterassociates.co.uk/the-red-ledger.html`

### Condition (Step 13) setup:
- Add a **Condition** step
- Rule: Email activity → **Clicked** → select the Day 5 email
- Yes path → End (do nothing)
- No path → Day 7 chase email

---

## 7. PECR footer — add Bluewater address

MailerLite auto-adds an unsubscribe link. You also need a physical address in every email.

1. In MailerLite, go to **Account** → **Company details**
2. Add Bluewater Associates registered address
3. This populates the footer on all emails automatically

---

## 8. Test before going live (~5 min)

1. Add yourself (`paulmc18@gmail.com` or another address you control) as a test subscriber to `The Red Ledger — Waitlist`
2. Confirm the Day 0 confirmation email lands within 5 minutes
3. Check subject line, preview text, and unsubscribe link
4. Check the Day 5 join link points to `bluewaterassociates.co.uk/the-red-ledger.html`
5. Confirm the condition logic is wired (you can preview without firing by clicking through MailerLite's automation preview)

---

## 9. Final checks before sharing the page

- [ ] SPF/DKIM records verified in MailerLite
- [ ] Zapier Zap is ON
- [ ] Automation is **Active** (not Draft)
- [ ] `[CLOSE DATE]` replaced in Day 5 and Day 7 emails
- [ ] Join link in Day 5 and Day 7 points to the landing page
- [ ] Test subscriber received Day 0 email
- [ ] Formspree dashboard notification email set to `hello@bluewaterassociates.co.uk`

---

## 10. Go

Once all checks pass:

1. Fire **Paul's LinkedIn Post 1** (the supplier ledger expertise post — no pitch)
2. Wait 4–5 days
3. Fire **Paul's LinkedIn Post 2** (the gap / Red Ledger intro) — tag Lynsey if connected
4. Wait 4–5 days
5. Fire **Paul's LinkedIn Post 3** (direct invite, link in first comment)

Lynsey mirrors with her 3 posts staggered 1–2 days behind each of Paul's.

---

*Generated: 2026-05-28 | The Red Ledger go-live execution*
