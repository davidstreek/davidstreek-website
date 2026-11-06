const limits = { name: 150, email: 254, phone: 60, project: 100, budget: 100, details: 5000 };

function respond(status, ok = false) {
  return Response.json({ ok }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) return respond(403);
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/x-www-form-urlencoded') {
    return respond(415);
  }

  const reader = request.body?.getReader();
  if (!reader) return respond(400);
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 65536) {
      await reader.cancel();
      return respond(413);
    }
    body += decoder.decode(value, { stream: true });
  }
  const form = new URLSearchParams(body + decoder.decode());
  if (form.get('website')) return respond(400);

  const fields = Object.fromEntries(Object.keys(limits).map(key => [key, (form.get(key) || '').trim()]));
  const { name, email, phone, project, budget, details } = fields;
  if (!name || !project || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      Object.entries(fields).some(([key, value]) => value.length > limits[key])) {
    return respond(400);
  }

  const { RESEND_API_KEY, ENQUIRY_FROM, ENQUIRY_TO } = env;
  const missingSettings = Object.entries({ RESEND_API_KEY, ENQUIRY_FROM, ENQUIRY_TO })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missingSettings.length) {
    console.warn('Enquiry mail settings missing:', missingSettings.join(', '));
    const response = respond(503);
    if (request.headers.get('X-Enquiry-Diagnostic') === 'missing-settings') {
      response.headers.set('X-Enquiry-Missing-Settings', missingSettings.join(', '));
    }
    return response;
  }

  try {
    const delivery = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from: ENQUIRY_FROM,
        to: [ENQUIRY_TO],
        reply_to: email,
        subject: 'Website enquiry',
        text: [
          'Name: ' + name,
          'Email: ' + email,
          'Phone: ' + (phone || 'Not provided'),
          'Project: ' + project,
          'Approximate budget: ' + (budget || 'Not sure yet'),
          '',
          details,
        ].join('\n'),
      }),
    });
    return delivery.ok ? respond(200, true) : respond(502);
  } catch {
    return respond(502);
  }
}
