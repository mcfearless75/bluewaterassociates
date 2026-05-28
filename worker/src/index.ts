/**
 * Bluewater API — Cloudflare Worker
 *
 * Routes:
 *   POST /twilio/voice          → IVR menu (CE / existing clients / IT support / voicemail)
 *   POST /twilio/ivr            → handles digit selection, dials with whisper
 *   POST /twilio/whisper        → plays intent to Paul before connecting
 *   POST /twilio/recording      → voicemail recording completed → ticket + email
 *   POST /twilio/transcription  → transcription complete → attach transcript to ticket
 *   POST /twilio/status         → call status callback → ticket on missed/no-answer
 *   POST /twilio/sms            → inbound SMS: BOOK → cal.com link; anything else → ticket
 *   POST /twilio/whatsapp       → inbound WhatsApp: BOOK → cal.com link; anything else → ticket
 *   POST /forms/readiness       → readiness checker form → ticket + email + SMS confirmation
 *   POST /forms/contact         → generic contact form → ticket + email + SMS confirmation
 *   POST /webhooks/formspree    → Formspree webhook → add subscriber to MailerLite group
 *   GET  /healthz               → liveness probe
 *
 * All Twilio routes verify the X-Twilio-Signature HMAC.
 */

export interface Env {
  TWILIO_AUTH_TOKEN: string;
  TWILIO_ACCOUNT_SID: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  RESEND_API_KEY: string;
  ALERT_FROM: string;
  ALERT_TO: string;
  ALLOWED_ORIGIN: string;
  TWILIO_PHONE_E164: string;
  FORWARD_TO_E164: string;
  WHATSAPP_PHONE_E164?: string; // optional — set once WhatsApp number is registered with Meta
  MAILERLITE_API_KEY?: string;  // secret — wrangler secret put MAILERLITE_API_KEY
  MAILERLITE_GROUP_ID?: string; // var — set in wrangler.toml after creating the MailerLite group
}

type TicketSource = 'voicemail' | 'missed_call' | 'call' | 'readiness' | 'contact';

interface TicketInsert {
  source: TicketSource;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  company?: string | null;
  subject?: string | null;
  body?: string | null;
  payload?: Record<string, unknown>;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });

const xml = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/xml; charset=utf-8' } });

const corsHeaders = (origin: string) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
});

function withCors(res: Response, env: Env): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(env.ALLOWED_ORIGIN))) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!),
  );
}

// Twilio signature: base64(HMAC-SHA1(authToken, fullUrl + sorted concatenated params))
async function verifyTwilio(req: Request, env: Env, params: URLSearchParams): Promise<boolean> {
  const sigHeader = req.headers.get('x-twilio-signature');
  if (!sigHeader) return false;

  const url = new URL(req.url);
  // Twilio signs the full public URL exactly as configured (we expect https).
  const fullUrl = `https://${url.host}${url.pathname}${url.search}`;

  const sortedKeys = [...params.keys()].sort();
  let payload = fullUrl;
  for (const k of sortedKeys) payload += k + (params.get(k) ?? '');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  // Constant-time compare
  if (expected.length !== sigHeader.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ sigHeader.charCodeAt(i);
  }
  return mismatch === 0;
}

async function readFormParams(req: Request): Promise<URLSearchParams> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await req.text());
  }
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const p = new URLSearchParams();
    for (const [k, v] of fd.entries()) p.append(k, typeof v === 'string' ? v : (v as File).name);
    return p;
  }
  return new URLSearchParams();
}

async function insertTicket(env: Env, t: TicketInsert): Promise<{ id?: string; error?: string }> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/tickets`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(t),
  });
  if (!r.ok) return { error: `supabase ${r.status}: ${await r.text()}` };
  const rows = (await r.json()) as Array<{ id: string }>;
  return { id: rows[0]?.id };
}

async function updateTicket(
  env: Env,
  id: string,
  patch: Partial<TicketInsert>,
): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/tickets?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(patch),
  });
}

async function findTicketByCallSid(env: Env, sid: string): Promise<string | null> {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/tickets?payload->>CallSid=eq.${encodeURIComponent(sid)}&select=id&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

async function sendEmail(
  env: Env,
  subject: string,
  html: string,
  replyTo?: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    from: `Bluewater Tickets <${env.ALERT_FROM}>`,
    to: [env.ALERT_TO],
    subject,
    html,
  };
  if (replyTo) body.reply_to = replyTo;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error('resend error', r.status, await r.text());
}

function ticketEmailHtml(opts: {
  heading: string;
  rows: Array<[string, string | null | undefined]>;
  body?: string | null;
  ticketUrl?: string;
}): string {
  const tr = opts.rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5a6273;vertical-align:top">${k}</td><td style="padding:6px 0;color:#0F1B2D"><strong>${escapeHtml(String(v))}</strong></td></tr>`,
    )
    .join('');
  const bodyBlock = opts.body
    ? `<div style="margin-top:16px;padding:12px 16px;background:#F5F1EA;border-left:3px solid #C75634;border-radius:4px;white-space:pre-wrap;color:#0F1B2D">${escapeHtml(opts.body)}</div>`
    : '';
  const cta = opts.ticketUrl
    ? `<p style="margin-top:24px"><a href="${opts.ticketUrl}" style="display:inline-block;background:#0F1B2D;color:#F5F1EA;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:500">Open ticket</a></p>`
    : '';
  return `<div style="font-family:'DM Sans',system-ui,sans-serif;color:#0F1B2D;max-width:560px">
<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:600;margin:0 0 16px">${escapeHtml(opts.heading)}</h2>
<table style="border-collapse:collapse;font-size:14px">${tr}</table>
${bodyBlock}${cta}
<p style="margin-top:24px;color:#5a6273;font-size:12px">Bluewater Associates · automated ticket alert</p>
</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!),
  );
}

async function sendSms(env: Env, to: string, body: string): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_PHONE_E164 || !to) return;
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: env.TWILIO_PHONE_E164, Body: body }).toString(),
    },
  );
  if (!r.ok) console.error('sms send error', r.status, await r.text());
}

async function sendWhatsApp(env: Env, to: string, body: string): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID || !env.WHATSAPP_PHONE_E164 || !to) return;
  // Twilio requires the whatsapp: prefix on both From and To
  const from = env.WHATSAPP_PHONE_E164.startsWith('whatsapp:')
    ? env.WHATSAPP_PHONE_E164
    : `whatsapp:${env.WHATSAPP_PHONE_E164}`;
  const toAddr = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: toAddr, From: from, Body: body }).toString(),
    },
  );
  if (!r.ok) console.error('whatsapp send error', r.status, await r.text());
}

// ─── handlers ─────────────────────────────────────────────────────────────────

async function handleVoice(req: Request, _env: Env, params: URLSearchParams): Promise<Response> {
  const caller = params.get('From') || 'unknown';
  console.log('inbound call from', caller);

  const baseHost = new URL(req.url).host;
  const ivrCb = `https://${baseHost}/twilio/ivr`;
  const recordingCb = `https://${baseHost}/twilio/recording`;
  const transcribeCb = `https://${baseHost}/twilio/transcription`;

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${escapeXml(ivrCb)}" method="POST" timeout="8">
    <Say voice="Polly.Amy">Welcome to Bluewater Associates. For a Cyber Essentials enquiry, press 1. For existing clients, press 2. For I T support, press 3. Or simply hold to leave a message.</Say>
  </Gather>
  <Say voice="Polly.Amy">No worries. Please leave a short message after the tone and we'll get back to you within one working day.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"
    transcribeCallback="${escapeXml(transcribeCb)}"
    action="${escapeXml(recordingCb)}" method="POST"/>
  <Hangup/>
</Response>`);
}

async function handleRecording(env: Env, params: URLSearchParams): Promise<Response> {
  const from = params.get('From') || '';
  const recUrl = params.get('RecordingUrl') || '';
  const recDuration = params.get('RecordingDuration') || '';

  const payload = Object.fromEntries(params.entries());
  const { id, error } = await insertTicket(env, {
    source: 'voicemail',
    contact_phone: from,
    subject: `Voicemail from ${from}`,
    body: `Recording: ${recUrl}.mp3\nDuration: ${recDuration}s\nTranscript: (pending)`,
    payload,
  });
  if (error) console.error(error);

  await sendEmail(
    env,
    `[Voicemail] ${from}`,
    ticketEmailHtml({
      heading: 'New voicemail',
      rows: [
        ['From', from],
        ['Duration', `${recDuration}s`],
        ['Recording', `${recUrl}.mp3`],
        ['Ticket', id || '(insert failed)'],
      ],
      body: 'Transcript will arrive in a follow-up email when ready.',
    }),
  );

  // SMS caller: confirm voicemail received
  if (from && from !== 'anonymous' && !from.startsWith('anonymous')) {
    await sendSms(
      env,
      from,
      `Thanks — we've got your voicemail (ref: ${id || 'pending'}). We'll be back in touch within 1 working day. Text BOOK any time to schedule a callback: https://cal.com/bluewater`,
    );
  }

  // Tell Twilio we're done (empty TwiML → hangup)
  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
}

async function handleTranscription(env: Env, params: URLSearchParams): Promise<Response> {
  const callSid = params.get('CallSid') || '';
  const transcript = params.get('TranscriptionText') || '(empty)';
  const status = params.get('TranscriptionStatus') || '';
  const from = params.get('From') || '';

  const ticketId = await findTicketByCallSid(env, callSid);
  if (ticketId) {
    await updateTicket(env, ticketId, {
      body: `Transcript (${status}):\n${transcript}`,
      payload: { ...Object.fromEntries(params.entries()) },
    });
  }

  await sendEmail(
    env,
    `[Voicemail transcript] ${from}`,
    ticketEmailHtml({
      heading: 'Voicemail transcript ready',
      rows: [
        ['From', from],
        ['Status', status],
        ['Ticket', ticketId || '(not linked)'],
      ],
      body: transcript,
    }),
    undefined,
  );

  return new Response('ok');
}

async function handleStatus(req: Request, env: Env, params: URLSearchParams): Promise<Response> {
  // Fires after a <Dial> attempt. DialCallStatus = completed | no-answer | busy | failed | canceled
  const dialStatus = params.get('DialCallStatus') || '';
  const from = params.get('From') || '';

  // If the call was actually answered, no ticket needed.
  if (dialStatus === 'completed') {
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const baseHost = new URL(req.url).host;
  const recordingCb = `https://${baseHost}/twilio/recording`;
  const transcribeCb = `https://${baseHost}/twilio/transcription`;

  const payload = Object.fromEntries(params.entries());
  const { id } = await insertTicket(env, {
    source: 'missed_call',
    contact_phone: from,
    subject: `Missed call from ${from}`,
    body: `Dial status: ${dialStatus}\nForwarding to voicemail prompt.`,
    payload,
  });

  await sendEmail(
    env,
    `[Missed call] ${from}`,
    ticketEmailHtml({
      heading: 'Missed call',
      rows: [
        ['From', from],
        ['Status', dialStatus],
        ['Time', new Date().toUTCString()],
        ['Ticket', id || null],
      ],
      body: 'Caller is being offered voicemail. Text BOOK to this number to book a callback.',
    }),
  );

  // SMS the caller — let them know we missed them and give them an easy next step
  if (from && from !== 'anonymous' && !from.startsWith('anonymous')) {
    await sendSms(
      env,
      from,
      `Sorry we missed your call to Bluewater Associates (0800 088 4711). Leave a voicemail after the tone, or text BOOK to this number to schedule a free callback. We aim to respond within 1 working day.`,
    );
  }

  // Continue to voicemail prompt
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Sorry we missed you. Please leave a short message after the tone and we'll get back to you within one working day.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"
    transcribeCallback="${escapeXml(transcribeCb)}"
    action="${escapeXml(recordingCb)}" method="POST"/>
  <Hangup/>
</Response>`);
}

async function handleIvr(req: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const digit = params.get('Digits') || '';
  const baseHost = new URL(req.url).host;
  const forward = env.FORWARD_TO_E164;
  const statusCb = `https://${baseHost}/twilio/status`;
  const recordingCb = `https://${baseHost}/twilio/recording`;
  const transcribeCb = `https://${baseHost}/twilio/transcription`;

  const intentLabels: Record<string, string> = {
    '1': 'Cyber+Essentials+enquiry',
    '2': 'Existing+client',
    '3': 'IT+support',
  };
  const sayLabels: Record<string, string> = {
    '1': 'Connecting you to our Cyber Essentials team.',
    '2': 'Connecting you to our client support team.',
    '3': 'Connecting you to I T support.',
  };

  if (forward && intentLabels[digit]) {
    const whisperUrl = `https://${baseHost}/twilio/whisper?intent=${intentLabels[digit]}`;
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">${sayLabels[digit]} Please hold.</Say>
  <Dial timeout="20" callerId="${escapeXml(env.TWILIO_PHONE_E164)}"
        action="${escapeXml(statusCb)}" method="POST">
    <Number url="${escapeXml(whisperUrl)}">${escapeXml(forward)}</Number>
  </Dial>
</Response>`);
  }

  // No valid digit or no forward number → go straight to voicemail
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Please leave a short message after the tone and we'll get back to you within one working day.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"
    transcribeCallback="${escapeXml(transcribeCb)}"
    action="${escapeXml(recordingCb)}" method="POST"/>
  <Hangup/>
</Response>`);
}

async function handleWhisper(_req: Request, _env: Env, params: URLSearchParams): Promise<Response> {
  // Plays a brief message to Paul *before* the call connects — so he knows why they're calling.
  const rawIntent = params.get('intent') || 'unknown';
  const intent = decodeURIComponent(rawIntent.replace(/\+/g, ' '));
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Bluewater call. Caller intent: ${escapeXml(intent)}. Connecting now.</Say>
</Response>`);
}

async function handleSms(_req: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const from = params.get('From') || '';
  const body = (params.get('Body') || '').trim();
  const keyword = body.toUpperCase().split(' ')[0];

  if (keyword === 'BOOK' || keyword === 'BOOKING' || keyword === 'SCHEDULE') {
    await sendSms(
      env,
      from,
      'Hi! Book a free 30-min discovery call here: https://cal.com/bluewater — we usually respond within one working day. Bluewater Associates.',
    );
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }

  if (keyword === 'STOP' || keyword === 'HELP' || keyword === 'UNSTOP') {
    // Let Twilio's built-in compliance handling deal with STOP/HELP; just return empty TwiML.
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }

  // Everything else → create a ticket and reply with an acknowledgement
  const payload = Object.fromEntries(params.entries());
  const { id } = await insertTicket(env, {
    source: 'contact',
    contact_phone: from,
    subject: `SMS from ${from}`,
    body,
    payload,
  });

  await sendEmail(
    env,
    `[SMS] ${from}`,
    ticketEmailHtml({
      heading: 'Inbound SMS',
      rows: [
        ['From', from],
        ['Message', body],
        ['Ticket', id || null],
      ],
    }),
  );

  await sendSms(
    env,
    from,
    `Thanks for your message. A member of the Bluewater team will be in touch shortly. Ref: ${id || 'pending'}`,
  );

  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
}

async function handleWhatsApp(_req: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const from = params.get('From') || ''; // arrives as whatsapp:+447xxxxxxxxx
  const body = (params.get('Body') || '').trim();
  const keyword = body.toUpperCase().split(' ')[0];

  if (keyword === 'BOOK' || keyword === 'BOOKING' || keyword === 'SCHEDULE') {
    await sendWhatsApp(
      env,
      from,
      'Hi! Book a free 30-min discovery call here: https://cal.com/bluewater — we usually respond within one working day. Bluewater Associates.',
    );
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }

  if (keyword === 'STOP' || keyword === 'HELP') {
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  }

  // Everything else → ticket + email + WhatsApp acknowledgement
  const payload = Object.fromEntries(params.entries());
  const { id } = await insertTicket(env, {
    source: 'contact',
    contact_phone: from,
    subject: `WhatsApp from ${from}`,
    body,
    payload,
  });

  await sendEmail(
    env,
    `[WhatsApp] ${from}`,
    ticketEmailHtml({
      heading: 'Inbound WhatsApp Message',
      rows: [
        ['From', from],
        ['Message', body],
        ['Ticket', id || null],
      ],
    }),
  );

  await sendWhatsApp(
    env,
    from,
    `Thanks for your message. A member of the Bluewater team will be in touch shortly. Ref: ${id || 'pending'}`,
  );

  return xml(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
}

async function handleFormReadiness(req: Request, env: Env): Promise<Response> {
  let data: Record<string, unknown> = {};
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  // Honeypot
  if (typeof data._gotcha === 'string' && data._gotcha.trim() !== '') {
    return json({ ok: true }); // silently accept bots
  }

  const name = (data.name as string) || null;
  const email = (data.email as string) || null;
  const company = (data.company as string) || null;
  const phone = (data.phone as string) || null;
  const prompt = (data.prompt as string) || null;
  const score = (data.score as number) ?? null;
  const band = (data.band as string) || null;
  const answers = data.answers_json ?? null;

  if (!email || !name) {
    return json({ ok: false, error: 'name and email are required' }, { status: 400 });
  }

  const { id, error } = await insertTicket(env, {
    source: 'readiness',
    contact_name: name,
    contact_email: email,
    contact_phone: phone,
    company,
    subject: `Readiness check: ${name} @ ${company || '—'} (${score ?? '?'}%)`,
    body: prompt,
    payload: { score, band, answers, ...data },
  });
  if (error) return json({ ok: false, error }, { status: 500 });

  await sendEmail(
    env,
    `[Readiness ${score ?? '?'}%] ${name} @ ${company || '—'}`,
    ticketEmailHtml({
      heading: 'New readiness submission',
      rows: [
        ['Name', name],
        ['Email', email],
        ['Company', company],
        ['Phone', phone],
        ['Score', score != null ? `${score}%` : null],
        ['Band', band],
        ['Ticket', id || null],
      ],
      body: prompt,
    }),
    email,
  );

  if (phone) {
    await sendSms(
      env,
      phone,
      `Thanks ${name ? name.split(' ')[0] : 'there'}! We've received your Cyber Essentials readiness results and will be in touch shortly. Questions? Call 0800 088 4711. Bluewater Associates.`,
    );
  }

  return json({ ok: true, id });
}

async function handleFormContact(req: Request, env: Env): Promise<Response> {
  let data: Record<string, unknown> = {};
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (typeof data._gotcha === 'string' && data._gotcha.trim() !== '') {
    return json({ ok: true });
  }
  const name = (data.name as string) || null;
  const email = (data.email as string) || null;
  const company = (data.company as string) || null;
  const phone = (data.phone as string) || null;
  const message = (data.message as string) || null;

  if (!email || !message) {
    return json({ ok: false, error: 'email and message required' }, { status: 400 });
  }
  const { id, error } = await insertTicket(env, {
    source: 'contact',
    contact_name: name,
    contact_email: email,
    contact_phone: phone,
    company,
    subject: `Contact: ${name || email}`,
    body: message,
    payload: data,
  });
  if (error) return json({ ok: false, error }, { status: 500 });

  await sendEmail(
    env,
    `[Contact] ${name || email}`,
    ticketEmailHtml({
      heading: 'New contact form submission',
      rows: [
        ['Name', name],
        ['Email', email],
        ['Company', company],
        ['Phone', phone],
        ['Ticket', id || null],
      ],
      body: message,
    }),
    email,
  );

  if (phone) {
    await sendSms(
      env,
      phone,
      `Thanks for reaching out to Bluewater Associates. We'll be back to you within one working day. You can also call us on 0800 088 4711. Ref: ${id || 'pending'}`,
    );
  }

  return json({ ok: true, id });
}

async function handleFormspreeWebhook(req: Request, env: Env): Promise<Response> {
  // Formspree sends a JSON POST to this endpoint when a form is submitted.
  // Configure in Formspree dashboard → form → Integrations → Webhook.
  let data: Record<string, unknown> = {};
  try {
    data = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  // Honour Formspree honeypot — silently accept spam submissions
  if (typeof data._gotcha === 'string' && data._gotcha.trim() !== '') {
    return json({ ok: true });
  }

  const email = (data.email as string) || null;
  // Formspree maps the name field to 'name'; fall back to '_name' (legacy) or 'first_name'
  const name = ((data.name || data._name || data.first_name) as string) || null;

  if (!email) {
    return json({ ok: false, error: 'email required' }, { status: 400 });
  }

  if (!env.MAILERLITE_API_KEY || !env.MAILERLITE_GROUP_ID) {
    console.error('MailerLite not configured — set MAILERLITE_API_KEY secret and MAILERLITE_GROUP_ID var');
    return json({ ok: false, error: 'ESP not configured' }, { status: 500 });
  }

  const payload: Record<string, unknown> = {
    email,
    groups: [env.MAILERLITE_GROUP_ID],
  };
  if (name) payload.fields = { name };

  const r = await fetch('https://connect.mailerlite.com/api/subscribers', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.MAILERLITE_API_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('MailerLite error', r.status, errText);
    return json({ ok: false, error: `MailerLite ${r.status}` }, { status: 500 });
  }

  return json({ ok: true });
}

// ─── router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env.ALLOWED_ORIGIN) });
    }

    if (path === '/healthz') return json({ ok: true });

    // Form endpoints (JSON, CORS-enabled)
    if (req.method === 'POST' && path === '/forms/readiness') {
      return withCors(await handleFormReadiness(req, env), env);
    }
    if (req.method === 'POST' && path === '/forms/contact') {
      return withCors(await handleFormContact(req, env), env);
    }
    if (req.method === 'POST' && path === '/webhooks/formspree') {
      return await handleFormspreeWebhook(req, env);
    }

    // Twilio endpoints (form-encoded, signature-verified)
    if (req.method === 'POST' && path.startsWith('/twilio/')) {
      const params = await readFormParams(req);
      const ok = await verifyTwilio(req, env, params);
      if (!ok) return new Response('signature mismatch', { status: 403 });

      if (path === '/twilio/voice')          return handleVoice(req, env, params);
      if (path === '/twilio/ivr')            return handleIvr(req, env, params);
      if (path === '/twilio/whisper')        return handleWhisper(req, env, params);
      if (path === '/twilio/recording')      return handleRecording(env, params);
      if (path === '/twilio/transcription')  return handleTranscription(env, params);
      if (path === '/twilio/status')         return handleStatus(req, env, params);
      if (path === '/twilio/sms')            return handleSms(req, env, params);
      if (path === '/twilio/whatsapp')       return handleWhatsApp(req, env, params);
    }

    return new Response('not found', { status: 404 });
  },
};
