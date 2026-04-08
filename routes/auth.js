const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const router = express.Router();
const googleClient = new OAuth2Client('991102462359-dguj0hp4cbmuuc5m16kidn6t09ns9a1k.apps.googleusercontent.com');

// In-memory token store (simple — resets on server restart; fine for student project)
const resetTokens = new Map(); // token → { email, expires }

// ─── Email transporter (Gmail) ─────────────────────────────────
const createTransporter = () => nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,  // your Gmail address
    pass: process.env.EMAIL_PASS,  // Gmail App Password (not your login password)
  },
});

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// ─────────────────────────────────────────────
//  POST /api/auth/register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });

    const user = await User.create({ name, email, password, phone: phone || '' });
    console.log(`✅ New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user)
      return res.status(401).json({ success: false, message: 'No account found with this email.' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch)
      return res.status(401).json({ success: false, message: 'Incorrect password.' });

    user.lastLogin = new Date();
    user.loginCount += 1;
    await user.save();
    console.log(`🔐 User logged in: ${user.email} | Login #${user.loginCount}`);

    res.json({
      success: true,
      message: 'Login successful.',
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, loginCount: user.loginCount, lastLogin: user.lastLogin, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/google — Google SSO
// ─────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken)
      return res.status(400).json({ success: false, message: 'Google ID token is required.' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: '991102462359-dguj0hp4cbmuuc5m16kidn6t09ns9a1k.apps.googleusercontent.com',
    });
    const { sub: googleId, email, name } = ticket.getPayload();

    if (!email)
      return res.status(400).json({ success: false, message: 'Could not get email from Google account.' });

    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

    if (user) {
      user.googleId = googleId;
      user.authProvider = 'google';
      user.lastLogin = new Date();
      user.loginCount += 1;
      if (!user.name && name) user.name = name;
      await user.save();
      console.log(`🔐 Google login: ${user.email} | Login #${user.loginCount}`);
    } else {
      user = await User.create({
        name: name || 'Google User',
        email: email.toLowerCase(),
        password: `google_${googleId}_${Date.now()}`,
        googleId,
        authProvider: 'google',
        lastLogin: new Date(),
        loginCount: 1,
      });
      console.log(`✅ New Google user: ${user.email}`);
    }

    res.json({
      success: true,
      message: 'Google sign-in successful.',
      token: generateToken(user._id),
      user: { id: user._id, name: user.name, email: user.email, loginCount: user.loginCount, authProvider: user.authProvider, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ success: false, message: 'Google sign-in failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/forgot-password  ← NEW
//  Sends real reset email via nodemailer
// ─────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: 'Email is required.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    // Always return success to avoid email enumeration
    if (!user) {
      return res.json({ success: true, message: 'If this email exists, a reset link was sent.' });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 15 * 60 * 1000; // 15 minutes
    resetTokens.set(token, { email: email.toLowerCase(), expires });

    // Reset link — deep link or web page
    const resetLink = `${process.env.FRONTEND_URL || 'https://spamshield-backend-zfb1.onrender.com'}/reset-password?token=${token}`;

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"SpamShield Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: '🔒 SpamShield — Reset Your Password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0f172a;color:#fff;border-radius:12px;padding:32px;">
          <div style="text-align:center;margin-bottom:24px;">
            <div style="display:inline-block;background:linear-gradient(135deg,#1d4ed8,#38bdf8);border-radius:12px;padding:12px 20px;">
              <span style="font-size:24px;">🛡️ SpamShield</span>
            </div>
          </div>
          <h2 style="color:#38bdf8;margin-bottom:8px;">Reset Your Password</h2>
          <p style="color:#94a3b8;line-height:1.6;">Hi ${user.name},<br><br>You requested a password reset for your SpamShield account. Click the button below to set a new password. This link expires in <strong style="color:#fff;">15 minutes</strong>.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${resetLink}" style="background:linear-gradient(135deg,#1d4ed8,#38bdf8);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;">Reset Password</a>
          </div>
          <p style="color:#64748b;font-size:12px;">If you didn't request this, ignore this email. Your password won't change.</p>
          <hr style="border-color:#1e293b;margin:24px 0;">
          <p style="color:#64748b;font-size:11px;text-align:center;">SpamShield Security Suite • vanshika.parikh694@gmail.com</p>
        </div>
      `,
    });

    console.log(`📧 Password reset email sent to: ${email}`);
    res.json({ success: true, message: 'Password reset link sent to your email.' });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ success: false, message: 'Could not send email. Please try again.' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/reset-password  ← NEW
//  Called with token from email link
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res.status(400).json({ success: false, message: 'Token and new password required.' });

    const entry = resetTokens.get(token);
    if (!entry || Date.now() > entry.expires) {
      resetTokens.delete(token);
      return res.status(400).json({ success: false, message: 'Reset link has expired. Please request a new one.' });
    }

    const user = await User.findOne({ email: entry.email }).select('+password');
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found.' });

    user.password = newPassword; // pre-save hook will hash it
    await user.save();
    resetTokens.delete(token);

    console.log(`✅ Password reset for: ${entry.email}`);
    res.json({ success: true, message: 'Password reset successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/admin-setup  ← ONE-TIME ADMIN FIX
//  Resets admin password (protected by secret key)
// ─────────────────────────────────────────────
router.post('/admin-setup', async (req, res) => {
  try {
    const { secretKey, email, newPassword } = req.body;
    // Only allow with the correct secret key
    if (secretKey !== process.env.ADMIN_SECRET_KEY) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      // Create admin from scratch if doesn't exist
      const newUser = await User.create({ name: 'Admin', email: email.toLowerCase(), password: newPassword });
      return res.json({ success: true, message: 'Admin created.', id: newUser._id });
    }

    user.password = newPassword;
    await user.save();
    console.log(`🔑 Admin password updated for: ${email}`);
    res.json({ success: true, message: 'Admin password updated successfully.' });
  } catch (err) {
    console.error('Admin setup error:', err.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'Not authenticated.' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    res.json({ success: true, user: { id: user._id, name: user.name, email: user.email, phone: user.phone, loginCount: user.loginCount, lastLogin: user.lastLogin, createdAt: user.createdAt } });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Token invalid or expired.' });
  }
});

// ─────────────────────────────────────────────
//  GET /api/auth/users  (admin)
// ─────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
