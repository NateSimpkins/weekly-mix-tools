const fs = require('fs');

const accessKey = process.env.S3_ACCESS_KEY_ID;
const secretKey = process.env.S3_SECRET_ACCESS_KEY;

if (!accessKey || !secretKey) {
  console.error('ERROR: S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set as environment variables.');
  process.exit(1);
}

let html = fs.readFileSync('index.html', 'utf8');
html = html.replace("'__S3_ACCESS_KEY_ID__'", JSON.stringify(accessKey));
html = html.replace("'__S3_SECRET_ACCESS_KEY__'", JSON.stringify(secretKey));
fs.writeFileSync('index.html', html);

console.log('Build complete — S3 credentials injected.');
