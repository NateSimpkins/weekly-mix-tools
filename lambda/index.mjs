import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const s3  = new S3Client({ region: process.env.S3_REGION });
const ses = new SESClient({ region: process.env.AWS_REGION });

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, prefix, subtitle, ticketUrl, imageUrl, market, email, notes } = body;

    if (!name || !ticketUrl || !email) {
      return {
        statusCode: 400,
        headers: CORS,
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

    // 2. Confirmation email to submitter
    await ses.send(new SendEmailCommand({
      Source: process.env.SES_SENDER_EMAIL,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: `Your Weekly Mix submission has been received — ${name}` },
        Body: {
          Text: {
            Data: [
              `Hi there,`,
              ``,
              `Thanks for submitting to The Weekly Mix! We've received your event and the team will review it shortly.`,
              ``,
              `Submission details:`,
              `  Event:   ${name}${prefix ? ` (${prefix})` : ''}`,
              subtitle ? `  Subtitle: ${subtitle}` : null,
              `  Market:  ${market || '—'}`,
              `  Tickets: ${ticketUrl}`,
              ``,
              `We'll be in touch if we need anything else.`,
              ``,
              `— The Weekly Mix Team`,
            ].filter(line => line !== null).join('\n'),
          },
        },
      },
    }));

    // 3. Internal notification email
    await ses.send(new SendEmailCommand({
      Source: process.env.SES_SENDER_EMAIL,
      Destination: { ToAddresses: [process.env.SES_NOTIFICATION_EMAIL] },
      Message: {
        Subject: { Data: `New Weekly Mix Submission — ${name}${market ? ` (${market})` : ''}` },
        Body: {
          Text: {
            Data: [
              `New submission received.`,
              ``,
              `Event:      ${name}`,
              prefix   ? `Prefix:     ${prefix}`   : null,
              subtitle ? `Subtitle:   ${subtitle}` : null,
              `Market:     ${market || '—'}`,
              `Tickets:    ${ticketUrl}`,
              imageUrl ? `Image:      ${imageUrl}` : null,
              `Email:      ${email}`,
              notes    ? `Notes:      ${notes}`    : null,
              ``,
              `Submitted:  ${submittedAt}`,
              `S3 key:     ${s3Key}`,
            ].filter(line => line !== null).join('\n'),
          },
        },
      },
    }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('weekly-mix-submissions error:', err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
