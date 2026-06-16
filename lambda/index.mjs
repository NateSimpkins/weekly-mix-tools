import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.S3_REGION });

const ALLOWED_ORIGINS = [
  'https://weekly-mix-builder.netlify.app',
  'https://weekly-mix-submissions.netlify.app',
];

function corsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const ASANA_API = 'https://app.asana.com/api/1.0';

async function asanaPost(path, data) {
  const res = await fetch(`${ASANA_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ASANA_ACCESS_TOKEN}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
    },
    body: JSON.stringify({ data }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.errors?.[0]?.message || res.statusText;
    throw new Error(`Asana API error (${res.status}): ${msg}`);
  }
  return json.data;
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS' || event.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  const path = event.rawPath || event.path || '/submit';

  // ── DELETE route ──────────────────────────────────────────────────────────
  if (path === '/delete') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { key } = body;
      if (!key || !key.startsWith('submissions/')) {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'Invalid key.' }) };
      }
      // Fetch existing JSON
      const getRes = await s3.send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      }));
      const existing = JSON.parse(await getRes.Body.transformToString());
      // Write back with status: 'used'
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: JSON.stringify({ ...existing, status: 'used' }, null, 2),
        ContentType: 'application/json',
      }));
      return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ success: true }) };
    } catch (err) {
      console.error('weekly-mix-delete error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── UPLOAD route ──────────────────────────────────────────────────────────
  if (path === '/upload') {
    try {
      const body = JSON.parse(event.body || '{}');
      const { image, contentType } = body;
      if (!image || !contentType) {
        return { statusCode: 400, headers: corsHeaders(event), body: JSON.stringify({ error: 'image and contentType are required.' }) };
      }
      const ext = contentType === 'image/png' ? 'png' : 'jpg';
      const key = `images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: Buffer.from(image, 'base64'),
        ContentType: contentType,
      }));
      const url = `https://weekly-mix-image.s3.us-east-1.amazonaws.com/${key}`;
      return { statusCode: 200, headers: corsHeaders(event), body: JSON.stringify({ url }) };
    } catch (err) {
      console.error('weekly-mix-upload error:', err);
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify({ error: err.message }) };
    }
  }

  // ── SUBMIT route ──────────────────────────────────────────────────────────
  try {
    const body = JSON.parse(event.body || '{}');
    const { name, prefix, subtitle, ticketUrl, imageUrl, market, email, notes } = body;

    if (!name || !ticketUrl || !email) {
      return {
        statusCode: 400,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'name, ticketUrl, and email are required.' }),
      };
    }

    const submittedAt = new Date().toISOString();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const timestamp = submittedAt.replace(/[:.]/g, '-').slice(0, 19);
    const s3Key = `submissions/${timestamp}-${slug}.json`;

    const submission = { name, prefix, subtitle, ticketUrl, imageUrl, market, email, notes, submittedAt };

    // 1. Write to S3
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(submission, null, 2),
      ContentType: 'application/json',
    }));

    // 2. Create Asana task
    const taskNotes = [
      `Event:       ${name}`,
      prefix   ? `Prefix:      ${prefix}`   : null,
      subtitle ? `Subtitle:    ${subtitle}` : null,
      `Market:      ${market || '—'}`,
      `Tickets:     ${ticketUrl}`,
      imageUrl ? `Image:       ${imageUrl}` : null,
      `Email:       ${email}`,
      notes    ? `Notes:       ${notes}`    : null,
      ``,
      `Submitted:   ${submittedAt}`,
      `S3 key:      ${s3Key}`,
    ].filter(line => line !== null).join('\n');

    const task = await asanaPost('/tasks', {
      name:      `[SUBMISSION] ${name} — ${market || 'No Market'}`,
      notes:     taskNotes,
      projects:  [process.env.ASANA_PROJECT_GID],
    });

    // 3. Add internal reviewer as follower for Asana notifications
    await asanaPost(`/tasks/${task.gid}/addFollowers`, {
      followers: ['nate.simpkins@ticketmaster.com'],
    });

    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('weekly-mix-submissions error:', err);
    return {
      statusCode: 500,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: err.message }),
    };
  }
};
