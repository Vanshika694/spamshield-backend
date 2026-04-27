const mongoose = require('mongoose');

const FeedbackSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  Msg: {
    type: String,
    required: true
  },
  Label: {
    type: String,
    enum: ['spam', 'not spam'],
    required: true
  },
  originalConfidence: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Feedback', FeedbackSchema);
