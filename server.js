require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const feedbackRoutes = require('./routes/feedback');
const { flushBuffer } = require('./services/feedbackBuffer');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Environment Validation ───────────────────
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

if (!MONGO_URI) {
  console.error('\n❌ ERROR: MONGO_URI is not defined in environment variables!');
}
if (!JWT_SECRET) {
  console.error('❌ ERROR: JWT_SECRET is not defined in environment variables!\n');
}

// ─── Middleware ───────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/feedback', feedbackRoutes);

// Health check (Works even if DB is down)
app.get('/', (req, res) => {
  res.json({
    status: mongoose.connection.readyState === 1 ? 'connected' : 'connecting/error',
    app: 'SpamShield Backend API',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    dbState: mongoose.connection.readyState
  });
});

// ─── MongoDB Atlas Connection ──────────────────
if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI, { dbName: 'spamshield' })
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch((err) => {
      console.error('\n❌ Database connection failed:');
      console.error(`   Error: ${err.message}`);
      console.error('   Hint: Check your IP Whitelist in MongoDB Atlas (set to 0.0.0.0/0)\n');
    });
}

// ─── Startup: flush leftover S3 buffer ─────────
if (process.env.S3_BUCKET_NAME) {
  flushBuffer().then((result) => {
    if (result.flushed) {
      console.log(`✅ Startup: flushed leftover buffer to S3 (${result.key})`);
    } else {
      console.log('ℹ️  Startup: no leftover feedback buffer to flush');
    }
  }).catch(() => {});
}

// ─── Start Server ──────────────────────────────
// We start the server immediately so Render doesn't timeout waiting for DB
app.listen(PORT, () => {
  console.log(`🚀 SpamShield API is active on port ${PORT}`);
  if (!MONGO_URI || !JWT_SECRET) {
    console.log('⚠️  WARNING: Service started without full environment configuration.');
  }
});
