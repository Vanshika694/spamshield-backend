// to run: node test/testFeedback.js

const http = require('http');

const HOST = process.env.TEST_HOST || 'localhost';
const PORT = process.env.TEST_PORT || 5000;
const NUM_REQUESTS = parseInt(process.argv[2], 10) || 30;

const SPAM_MESSAGES = [
  'Congratulations! You won a $1000 Walmart gift card. Click here to claim.',
  'URGENT: Your account will be suspended. Verify now at http://scam-link.com',
  'Make $5000/day from home! No experience needed. Sign up today!',
  'FREE iPhone 15! You have been selected. Reply YES to claim.',
  'Hot singles in your area are waiting for you. Click now!',
  'Your loan is pre-approved! Get $50,000 instantly with no credit check.',
  'You have inherited $4.5 million. Send your bank details to claim.',
  'Lose 30 pounds in 30 days with this one weird trick!',
  'Discount CODE: SAVE90 — Limited time deal on all medications!',
  'Dear winner, your email was selected for a $1,000,000 prize.'
];

const HAM_MESSAGES = [
  'Hey, are we still meeting for lunch tomorrow?',
  'Can you review the PR I submitted this morning?',
  'Happy birthday! Hope you have a great day.',
  'I will be home late tonight, please start dinner without me.',
  'The meeting has been moved to 3 PM instead of 2 PM.',
  'Just checking in — how is the project going?',
  'Thanks for sending the report, I will take a look at it.',
  'Reminder: team standup at 10 AM tomorrow.',
  'Can you pick up milk on your way back?',
  'I pushed the latest changes to the staging branch.'
];

function sendFeedback(index) {
  return new Promise((resolve, reject) => {
    const isSpam = Math.random() > 0.5;
    const label = isSpam ? 'spam' : 'not spam';
    const messagePool = isSpam ? SPAM_MESSAGES : HAM_MESSAGES;
    const messageBody = messagePool[index % messagePool.length];
    const confidence = Math.round((Math.random() * 0.4 + 0.6) * 100) / 100;

    const payload = JSON.stringify({
      username: `test_user_${(index % 5) + 1}`,
      messageBody,
      label,
      confidence
    });

    const options = {
      hostname: HOST,
      port: PORT,
      path: '/api/feedback/report',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        const status = res.statusCode;
        const flushed = JSON.parse(body).s3Flushed ? ' [S3 FLUSHED]' : '';
        console.log(
          `#${String(index + 1).padStart(3)} ${status === 201 ? '✓' : '✗'} ${status} | ${label.padEnd(9)} conf=${confidence} | user=test_user_${(index % 5) + 1}${flushed}`
        );
        resolve({ status, body });
      });
    });

    req.on('error', (err) => {
      console.log(`#${String(index + 1).padStart(3)} ✗ Error: ${err.message}`);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

async function run() {
  const total = Math.min(NUM_REQUESTS, 500);
  console.log(`\n🧪 Sending ${total} feedback requests to http://${HOST}:${PORT}/api/feedback/report`);
  console.log(`   Batch size threshold: 25 entries\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < total; i++) {
    try {
      await sendFeedback(i);
      success++;
    } catch {
      failed++;
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  console.log(`\n📊 Results: ${success} succeeded, ${failed} failed out of ${total} requests`);
  console.log('   Check MongoDB and your S3 bucket for stored entries.\n');
}

run();