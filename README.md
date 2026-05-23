# Bluewater Associates

Marketing site for **Bluewater Associates Limited** (Companies House 16663061) — Cyber Essentials, managed IT, M365, and digital services for UK SMBs.

Live: https://bluewaterassociates.co.uk

## Stack

- Static HTML/CSS/JS, no build step
- Hosted on **GitHub Pages** (custom domain via `CNAME`)
- Fonts: Google Fonts (Fraunces + DM Sans)
- Analytics: [Plausible](https://plausible.io) (privacy-focused, cookie-free)
- Bookings: [Cal.com](https://cal.com) embed → `cal.com/bluewaterassociates/15min`
- Lead form: [Formspree](https://formspree.io) (swap the placeholder endpoint in `readiness.html` after sign-up)

## Files

| File | Purpose |
|---|---|
| `index.html` | Main marketing site |
| `readiness.html` | Free Cyber Essentials readiness check (lead magnet) |
| `privacy.html` | UK GDPR privacy policy (under solicitor review) |
| `terms.html` | Website terms of use (under solicitor review) |
| `404.html` | Not-found page |
| `sitemap.xml` | Sitemap for search engines |
| `robots.txt` | Crawl rules + sitemap reference |
| `CNAME` | GitHub Pages custom domain binding |

## Pre-launch checklist

- [ ] Replace `+44 1234 567890` placeholders (search `index.html`)
- [ ] Replace `[insert registered office address]` in `index.html`, `privacy.html`, `terms.html`
- [ ] Sign up for Formspree → swap `REPLACE_WITH_FORMSPREE_ID` in `readiness.html`
- [ ] Add real `logo.png`, `favicon.ico`, `og-image.png` (1200×630) to repo root
- [ ] Solicitor review of `privacy.html` and `terms.html`
- [ ] Verify `bluewaterassociates.co.uk` in Google Search Console (DNS TXT)
- [ ] Submit sitemap to GSC + Bing Webmaster Tools

## DNS (GoDaddy → GitHub Pages)

Add these A records on the apex (`@`):

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Add CNAME for `www`:

```
www  →  mcfearless75.github.io
```

## DNS (Microsoft 365 mail)

After adding the M365 domain in the admin centre, the wizard will produce records similar to these — use the exact values from your tenant:

```
MX     @                10  bluewaterassociates-co-uk.mail.protection.outlook.com
TXT    @                v=spf1 include:spf.protection.outlook.com -all
CNAME  autodiscover     autodiscover.outlook.com
CNAME  selector1._domainkey  selector1-bluewaterassociates-co-uk._domainkey.<tenant>.onmicrosoft.com
CNAME  selector2._domainkey  selector2-bluewaterassociates-co-uk._domainkey.<tenant>.onmicrosoft.com
TXT    _dmarc           v=DMARC1; p=quarantine; rua=mailto:dmarc@bluewaterassociates.co.uk; fo=1; pct=100
```

Verify at [mxtoolbox.com](https://mxtoolbox.com) (SPF, DKIM, DMARC) and [mail-tester.com](https://mail-tester.com) after 24h propagation.

## Local development

Open `index.html` directly in a browser, or run:

```bash
python -m http.server 8000
# then http://localhost:8000
```

## Deploy

`git push origin main` — GitHub Pages publishes automatically from the `main` branch root.
