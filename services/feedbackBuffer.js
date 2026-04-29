const fs = require('fs');
const path = require('path');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { s3, S3_BUCKET } = require('../config/s3');

const BUFFER_DIR = path.join(__dirname, '..', 'data');
const BUFFER_FILE = path.join(BUFFER_DIR, 'feedback_buffer.csv');
const BATCH_SIZE = parseInt(process.env.FEEDBACK_BATCH_SIZE, 10) || 25;

const CSV_HEADERS = 'Msg,Label\n';

function ensureBufferFile() {
  if (!fs.existsSync(BUFFER_DIR)) {
    fs.mkdirSync(BUFFER_DIR, { recursive: true });
  }
  if (!fs.existsSync(BUFFER_FILE)) {
    fs.writeFileSync(BUFFER_FILE, CSV_HEADERS);
  }
}

function escapeCsvField(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function entryToCsvRow(entry) {
  return [
    escapeCsvField(entry.Msg),
    escapeCsvField(entry.Label),
  ].join(',') + '\n';
}

function appendToBuffer(entry) {
  ensureBufferFile();

  const row = entryToCsvRow(entry);
  fs.appendFileSync(BUFFER_FILE, row);

  const content = fs.readFileSync(BUFFER_FILE, 'utf8');
  const dataRowCount = content
    .trim()
    .split('\n')
    .filter(Boolean).length - 1;

  if (dataRowCount >= BATCH_SIZE) {
    return flushBuffer();
  }

  return { flushed: false, count: dataRowCount };
}

async function flushBuffer() {
  ensureBufferFile();

  const content = fs.readFileSync(BUFFER_FILE, 'utf8').trim();
  if (!content || content === CSV_HEADERS.trim()) {
    return { flushed: false, count: 0 };
  }

  if (!S3_BUCKET) {
    console.warn('⚠️  S3_BUCKET_NAME not set — skipping S3 upload');
    return { flushed: false, count: 0 };
  }

  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-');
  const key = `feedback/${dateStr}_data.csv`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: 'text/csv'
      })
    );

    console.log(`✅ Flushed feedback batch to S3: ${key}`);
    fs.writeFileSync(BUFFER_FILE, CSV_HEADERS);
    return { flushed: true, key };
  } catch (err) {
    console.error('❌ S3 upload failed:', err.message);
    return { flushed: false, error: err.message };
  }
}

module.exports = { appendToBuffer, flushBuffer };