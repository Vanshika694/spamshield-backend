const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');

// POST /api/feedback/report
// Stores user feedback for model retraining
router.post('/report', async (req, res) => {
  try {
    const { username, messageBody, label, confidence } = req.body;

    if (!username || !messageBody || !label) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const newFeedback = new Feedback({
      username,
      messageBody,
      label,
      originalConfidence: confidence || 0
    });

    await newFeedback.save();
    res.status(201).json({ message: 'Feedback stored successfully' });
  } catch (err) {
    console.error('❌ Feedback storage error:', err);
    res.status(500).json({ error: 'Failed to store feedback' });
  }
});

module.exports = router;
