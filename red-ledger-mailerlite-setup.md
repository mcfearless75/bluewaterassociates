# The Red Ledger — MailerLite Setup & Automation Guide

## Overview

MailerLite (free up to 1,000 subscribers) handles the entire 5-day challenge sequence.
Once wired in, every waitlist sign-up automatically gets:
- Immediate: confirmation email
- Day 1–5: one email per day at 8am
- Day 7 (non-buyers only): closing offer chase

Total setup time: ~45 minutes.

---

## Part 1 — MailerLite Account

1. Go to **mailerlite.com** → Sign Up Free
2. Use `hello@bluewaterassociates.co.uk` as the sending address
3. Verify your email address when prompted
4. When asked about your website, enter `bluewaterassociates.co.uk`
5. Complete the sender verification steps (they'll ask you to add a DNS record — do this in Cloudflare DNS; it takes ~10 minutes to propagate)

**Sender details to set:**
- From name: `Paul McWilliam — The Red Ledger`
- Reply-to: `hello@bluewaterassociates.co.uk`

---

## Part 2 — Create the Group

Groups = audience segments. Everyone who signs up goes into one group.

1. Left sidebar → **Subscribers** → **Groups**
2. Click **Create group**
3. Name: `The Red Ledger — Waitlist`
4. Save

---

## Part 3 — Create the Signup Form (replaces Formspree)

This generates the form endpoint that the landing page will POST to.

1. Left sidebar → **Forms** → **Embedded forms**
2. Click **Create embedded form**
3. Name: `Red Ledger Waitlist Form`
4. Connect to group: `The Red Ledger — Waitlist`
5. Fields to add:
   - Email (required — already there)
   - First name (required)
   - Custom field: `role` (text)
   - Custom field: `interest` (text)
6. Save the form
7. Go to **Form settings** → look for **Form endpoint / API URL**
   - It will look like: `https://app.mailerlite.com/webforms/submit/XXXXXXXX`
   - Copy this URL

> **Note:** MailerLite also lets you use their JavaScript embed. The endpoint URL approach is cleaner for a custom-styled form.

---

## Part 4 — Update the Landing Page Form

Open `the-red-ledger.html` and replace **both** Formspree endpoints with the MailerLite URL.

Find (appears twice):
```html
action="https://formspree.io/f/mwvzyvpe"
```

Replace with:
```html
action="https://app.mailerlite.com/webforms/submit/XXXXXXXX"
```

Also update the hidden field names to match MailerLite's expected format:
```html
<!-- Remove this Formspree field: -->
<input type="hidden" name="_subject" value="..." />
<input type="hidden" name="_next" value="..." />

<!-- MailerLite uses these instead: -->
<input type="hidden" name="fields[email]" value="" />   <!-- MailerLite maps name="email" automatically -->
<input type="hidden" name="ml-submit" value="1" />
<input type="hidden" name="anticsrf" value="true" />
```

> Alternatively: keep Formspree for form capture + email notification, and use a **Zapier free tier** to connect Formspree → MailerLite (5 min setup, no code). See Part 4b below.

---

## Part 4b — Zapier Bridge (easier, keeps existing form)

If you don't want to change the landing page form at all:

1. Go to **zapier.com** → free account
2. New Zap:
   - **Trigger**: Formspree → New Submission
   - Connect your Formspree account, select the Red Ledger form
3. **Action**: MailerLite → Create/Update Subscriber
   - Map: Email → email, First name → first_name
   - Set group: `The Red Ledger — Waitlist`
4. Turn Zap on

Every Formspree submission now auto-adds to MailerLite and triggers the automation.
Free Zapier = 100 tasks/month = fine for early stage.

---

## Part 5 — Build the Automation

This is the sequence that fires the 5-day challenge.

1. Left sidebar → **Automations** → **Create automation**
2. Name: `The Red Ledger — 5-Day Challenge`
3. Trigger: **When subscriber joins a group** → select `The Red Ledger — Waitlist`

**Add these steps in order:**

---

### Step 1 — Send email immediately (Confirmation / Day 0)

Action: **Send email**

```
Subject:    You're in. Day 1 lands tomorrow morning.
Preview:    Five questions. Five days. Here's what to expect.
```

Body (plain text style — no heavy design needed):

```
Hi {$name},

You're on the list.

Starting tomorrow at 8am, you'll get one email per day for five days.

Each one has a single question — the kind that comes up in fraud investigations,
cyber audits, and AI conversations. Real scenarios. No trick answers. No fluff.

By Day 5, you'll know exactly where you stand — and what The Red Ledger is
doing about the gaps most professionals have.

See you tomorrow.

Paul & Lynsey
The Red Ledger

---
If you didn't sign up for this, unsubscribe below.
```

---

### Step 2 — Wait 1 day

Action: **Delay** → 1 day
(Set to send at 8:00am — MailerLite lets you pin the send time)

---

### Step 3 — Send Day 1 email

```
Subject:    You probably can't answer this. (Neither could I.)
Preview:    It's a single question. Give it 60 seconds.
```

Body:

```
Hi {$name},

Welcome to the Red Ledger Five.

Over the next five days, I'm going to ask you one question per day.

Not trick questions. Not a quiz for the sake of it. Real questions — the kind
that come up in incident calls, fraud investigations, and boardroom conversations.

Here's Day 1:

---

A client calls you. Their bookkeeper has just resigned unexpectedly.
The MD is worried. Where do you look first?

Take 60 seconds. Write your answer down — in notes, on paper, wherever.
You don't send it to anyone. It's just for you.

---

Tomorrow I'll tell you exactly what a forensic accountant looks for in that
scenario — and why most people look in the wrong place first.

If you got it right, great. If you didn't, you're in the right place.

Paul McWilliam
The Red Ledger
```

---

### Step 4 — Wait 1 day (8am)

---

### Step 5 — Send Day 2 email

```
Subject:    What Lynsey looks for first (most people get this wrong)
Preview:    The answer to yesterday's question — plus Day 2.
```

Body:

```
Hi {$name},

Yesterday I asked: a bookkeeper resigns unexpectedly. Where do you look first?

Most people say: bank statements.

That's not wrong. But it's not first.

Lynsey Graham — GIAC GSEC & GFACT certified forensic accountant — looks at
this first: the supplier ledger.

Here's why.

Most bookkeeper fraud runs through suppliers. Fictitious vendors. Inflated
invoices. Split payments kept below approval thresholds. The bank statement
shows money going out — but it doesn't tell you why or to whom without context.

The supplier ledger tells you who got paid. Then you cross-reference against
Companies House, the contract, and the approval chain.

You can spot a pattern in under an hour if you know what you're looking at.

That's the difference between knowing fraud exists and being able to evidence it.

---

Day 2 question:

Your client mentions they've "got Cyber Essentials." You ask who issued it.
They don't know. Should you be concerned?

Write your answer down. Tomorrow I'll explain what that question actually
reveals — and it's not what most people think.

Paul
```

---

### Step 6 — Wait 1 day (8am)

---

### Step 7 — Send Day 3 email

```
Subject:    "We've got Cyber Essentials" — and what that actually means
Preview:    The answer matters more than the cert.
```

Body:

```
Hi {$name},

Yesterday's question: your client has Cyber Essentials but doesn't know who
issued it. Should you be concerned?

Yes. Here's why.

Cyber Essentials is issued by IASME-accredited certification bodies. If a
business can't name their assessor, one of two things happened:

1. They used an online self-assessment tool, ticked the boxes quickly, and
   got the badge without a real audit.

2. The cert was managed by someone who's left — and nobody has since checked
   whether it's still valid or been renewed.

Cyber Essentials has to be renewed annually. A lapsed cert means a lapsed
security posture — but companies keep displaying the badge.

The cert is worth something. The badge alone is worth nothing.

This is the kind of thing that matters in a due diligence conversation, a
supplier onboarding check, or an insurance claim.

---

Day 3 question:

Someone sends you a document via WhatsApp. You need to review it for a client
meeting. You open it on your work phone. What's the risk — and what should
you have done instead?

Take 30 seconds. Write it down.

Tomorrow's answer will surprise people who think they already know this one.

Paul
```

---

### Step 8 — Wait 1 day (8am)

---

### Step 9 — Send Day 4 email

```
Subject:    The WhatsApp document mistake (more people make this than admit it)
Preview:    It's not about the app. It's about what happens after you open it.
```

Body:

```
Hi {$name},

Yesterday: you open a WhatsApp document on your work phone. What's the risk?

Most people say: "WhatsApp isn't secure" or "I shouldn't use personal apps
for work."

Those aren't wrong. But the real risk is more specific.

When you open a document on a mobile device — any device — the file is saved
locally. On WhatsApp, by default, to your camera roll or downloads folder.
If your phone is not encrypted, not enrolled in your company's MDM (mobile
device management), and not wiped if lost — that document is now available
to whoever finds or steals your phone.

The sender sent it securely. You received it securely. The risk appeared
the moment you opened it outside a controlled environment.

The fix: mobile device policy. Which most small firms don't have. Which is
exactly what Cyber Essentials asks you about.

---

Day 4 question — and this one's about AI:

Your colleague uses ChatGPT to draft a report. They paste in a client's
financial summary to give it context. What have they just done?

Tomorrow is Day 5. I'll answer this — and I'll tell you what The Red Ledger
is, what it costs, and whether it's for you.

No pressure. No hard sell. Just the full picture.

Paul
```

---

### Step 10 — Wait 1 day (8am)

---

### Step 11 — Send Day 5 email (the offer)

```
Subject:    The ChatGPT answer — and what we're building
Preview:    Day 5. Here's the answer, and here's the offer.
```

Body:

```
Hi {$name},

Day 5.

Yesterday: your colleague pastes a client's financial summary into ChatGPT
to help draft a report. What have they done?

They've submitted client data to a third-party AI model that, depending on
the plan and settings, may use that data for training.

OpenAI's free and Plus plans default to using conversations for model
improvement unless you opt out in settings. If that financial summary
contained personal data — names, account numbers, company financials —
your colleague may have just created a data breach under UK GDPR.

Not because they did something malicious. Because nobody told them.

That's the gap we're here to close.

---

Over five days, you've had a taste of what Lynsey and I deal with every week —
the real, specific, practitioner-level knowledge that doesn't come from a
one-day workshop or a YouTube video.

Here's what we're building.

The Red Ledger is a professional community for people exactly like you —
accountants, IT managers, finance leads, and compliance officers who need to
get sharp on cyber, fraud, and AI. Not theory. Applied skills you can use
on Monday.

Three pillars:
- Forensic accounting and fraud investigation (Lynsey leads this — there's
  genuinely nowhere else like it)
- Cyber cert prep — GFACT, GSEC, Security+
- Practical AI and GitHub for non-engineers

We're opening founding member access at £29/month — that price is only
available to people on this list, and it closes on [CLOSE DATE].

After that it's £79/mo. The content isn't different. The price is.

[JOIN AS A FOUNDING MEMBER →]
https://bluewaterassociates.co.uk/the-red-ledger.html

If it's not for you right now, no problem. You've still got five days of
solid material you can put to work. That was always the point.

If you have questions, reply to this email. I read every one.

Paul McWilliam
The Red Ledger / Bluewater Associates

P.S. Lynsey's forensic accounting module goes places the Big Four charge
£1,500 for a day to cover. Just saying.
```

---

### Step 12 — Wait 2 days

---

### Step 13 — Condition: Did they click the join link?

Action: **Condition**
- If subscriber **clicked** the Day 5 join link → **End / do nothing**
- If subscriber **did not click** → continue to Step 14

(In MailerLite: add a "Condition" step → "Email activity" → "Clicked" → the Day 5 email)

---

### Step 14 — Send Day 7 chase (non-clickers only)

```
Subject:    Closing the founding member price on [DATE]
Preview:    £29/mo ends when the door closes.
```

Body:

```
Hi {$name},

Founding member pricing closes on [DATE].

After that, membership moves to £79/month. The community and content are
identical — the founding price is a thank-you to the people who committed early.

If you went through the five days and thought "this is exactly what I need"
— now's the time.

[JOIN AS A FOUNDING MEMBER →]
https://bluewaterassociates.co.uk/the-red-ledger.html

If the timing isn't right, no problem. You're welcome back at the full
price whenever it is.

Paul
```

---

## Part 6 — Test Before Going Live

1. Add yourself as a test subscriber to the `The Red Ledger — Waitlist` group
2. Confirm confirmation email arrives within 5 minutes
3. Use MailerLite's "Preview" to check each email on mobile and desktop
4. Check all links work (especially the Day 5 join link)
5. Confirm the Day 7 condition logic works with a test click/no-click

---

## Part 7 — Replace [CLOSE DATE] Before Launch

Both Day 5 and Day 7 emails contain `[CLOSE DATE]` and `[JOIN AS A FOUNDING MEMBER →]`.

**Close date**: pick 14 days from the day you start sending traffic to the page.
Update both emails in MailerLite before activating the automation.

---

## Part 8 — DNS / Deliverability Checklist

Before sending to real subscribers:

- [ ] SPF record added to Cloudflare DNS (MailerLite provides the value)
- [ ] DKIM record added (MailerLite provides — two CNAME records)
- [ ] Sender email verified in MailerLite
- [ ] Test email passes spam check (MailerLite has built-in spam score tool)
- [ ] Unsubscribe link present in every email (MailerLite adds this automatically)
- [ ] Physical address in footer (required by UK PECR — use Bluewater's registered address)

---

## Summary: Automation Flow

```
Sign-up
  │
  ├─► Immediate: Confirmation (Day 0)
  │
  ├─► +1 day 8am: Day 1 — Bookkeeper question
  │
  ├─► +1 day 8am: Day 2 — Supplier ledger answer + CE question
  │
  ├─► +1 day 8am: Day 3 — CE answer + WhatsApp question
  │
  ├─► +1 day 8am: Day 4 — WhatsApp answer + ChatGPT question
  │
  ├─► +1 day 8am: Day 5 — ChatGPT answer + founding member offer
  │
  └─► +2 days:
        ├─ Clicked join link? → END
        └─ Did not click?    → Day 7 chase email
```

---

*Generated: 2026-05-28 | The Red Ledger — MailerLite automation setup*
