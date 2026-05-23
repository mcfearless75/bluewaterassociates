/**
 * Bluewater API — Cloudflare Worker
 *
 * Routes:
 *   POST /twilio/voice          → answers inbound call (TwiML: forward, then voicemail)
 *   POST /twilio/recording      → voicemail recording completed → ticket + email
 *   POST /twilio/transcription  → transcription complete → attach transcript to ticket
 *   POST /twilio/status         → call status callback → ticket on missed/no-answer
 *   POST /forms/readiness       → readiness checker form → ticket + email
 *   POST /forms/contact         → generic contact form → ticket + email
 *   GET  /healthz               → liveness probe
 *
 * All Twilio routes verify the X-Twilio-Signature HMAC.
 */

export interface Env {
  TWILIO_AUTH_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  RESEND_API_KEY: string;
  ALERT_FROM: string;
  ALERT_TO: string;
  ALLOWED_ORIGIN: string;
  TWILIO_PHONE_E164: string;
  FORWARD_TO_E164: string;
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
    for (const [k, v] of fd.entries()) p.append(k, typeof v === 'string' ? v : v.name);
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

// ─── handlers ─────────────────────────────────────────────────────────────────

async function handleVoice(_req: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const caller = params.get('From') || 'unknown';
  console.log('inbound call from', caller);

  // If FORWARD_TO_E164 is set, try to ring the mobile first; on no-answer/busy/failed → voicemail.
  // Action callback hits /twilio/status for missed-call detection.
  const forward = env.FORWARD_TO_E164;
  const baseHost = new URL(_req.url).host;
  const statusCb = `https://${baseHost}/twilio/status`;
  const recordingCb = `https://${baseHost}/twilio/recording`;
  const transcribeCb = `https://${baseHost}/twilio/transcription`;

  const dialBlock = forward
    ? `<Dial timeout="20" callerId="${escapeXml(env.TWILIO_PHONE_E164)}" action="${escapeXml(statusCb)}" method="POST">
    <Number>${escapeXml(forward)}</Number>
  </Dial>`
    : '';

  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${dialBlock}
  <Say voice="Polly.Amy">You've reached Bluewater Associates. Please leave a short message after the tone and we'll get back to you within one working day.</Say>
  <Record
    maxLength="120"
    playBeep="true"
    trim="trim-silence"
    transcribe="true"
    transcribeCallback="${escapeXml(transcribeCb)}"
    action="${escapeXml(recordingCb)}"
    method="POST"
  />
  <Say voice="Polly.Amy">We didn't catch a message. Goodbye.</Say>
</Response>`);
}

async function handleRecording(env: Env, params: URLSearchParams): Promise<Response> {
  const callSid = params.get('CallSid') || '';
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

async function handleStatus(env: Env, params: URLSearchParams): Promise<Response> {
  // Fires after a <Dial> attempt. DialCallStatus = completed | no-answer | busy | failed | canceled
  const dialStatus = params.get('DialCallStatus') || '';
  const from = params.get('From') || '';
  const callSid = params.get('CallSid') || '';

  // If the call was actually answered, no missed-call ticket needed.
  if (dialStatus === 'completed') {
    return xml(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  // Forward not answered → fall through to voicemail prompt
  const baseHost = new URL(`https://${params.get('host') || 'bluewaterassociates.co.uk'}/`).host;
  void baseHost; // not used here; just keep types tidy

  const payload = Object.fromEntries(params.entries());
  const { id } = await insertTicket(env, {
    source: 'missed_call',
    contact_phone: from,
    subject: `Missed call from ${from}`,
    body: `Dial status: ${dialStatus}\nForwarding to voicemail prompt.`,
    payload,
  });
  void id;

  // Continue to voicemail prompt
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Amy">Sorry we missed you. Please leave a short message after the tone and we'll get back to you within one working day.</Say>
  <Record maxLength="120" playBeep="true" trim="trim-silence" transcribe="true"
    transcribeCallback="https://${new URL('https://placeholder/').host}/twilio/transcription"
    action="/twilio/recording" method="POST"/>
  <Hangup/>
</Response>`);
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

  return json({ ok: true, id });
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

    // Twilio endpoints (form-encoded, signature-verified)
    if (req.method === 'POST' && path.startsWith('/twilio/')) {
      const params = await readFormParams(req);
      const ok = await verifyTwilio(req, env, params);
      if (!ok) return new Response('signature mismatch', { status: 403 });

      if (path === '/twilio/voice')          return handleVoice(req, env, params);
      if (path === '/twilio/recording')      return handleRecording(env, params);
      if (path === '/twilio/transcription')  return handleTranscription(env, params);
      if (path === '/twilio/status')         return handleStatus(env, params);
    }

    return new Response('not found', { status: 404 });
  },
};
