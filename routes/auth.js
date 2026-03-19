const express = require('express');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');

const router = express.Router();
const googleClient = new OAuth2Client('991102462359-dguj0hp4cbmuuc5m16kidn6t09ns9a1k.apps.googleusercontent.com');

// Helper — generate JWT token
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
//  POST /api/auth/google  ← NEW: Google SSO
// ─────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken)
      return res.status(400).json({ success: false, message: 'Google ID token is required.' });

    // Verify the token with Google's servers
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: '991102462359-dguj0hp4cbmuuc5m16kidn6t09ns9a1k.apps.googleusercontent.com',
    });
    const { sub: googleId, email, name } = ticket.getPayload();

    if (!email)
      return res.status(400).json({ success: false, message: 'Could not get email from Google account.' });

    // Find or create user (upsert)
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
