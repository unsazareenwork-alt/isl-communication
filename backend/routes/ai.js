const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { isValidUUID, isNonEmptyString } = require('../utils/validate');
const translateText = require('../utils/translateText');

const REGIONAL_LANGUAGE = 'ta';

// POST /api/ai/predict
router.post('/predict', authMiddleware, async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is missing or invalid JSON' });
  }

  const senderId = req.user.id;
  const senderName = req.user.user_metadata?.name || 'Anonymous';
  const { meeting_id, sign, confidence, language } = req.body;

  if (!isValidUUID(meeting_id)) {
    return res.status(400).json({ error: 'meeting_id must be a valid UUID' });
  }

  if (!isNonEmptyString(sign, 200)) {
    return res.status(400).json({ error: 'sign is required and must be non-empty text' });
  }

  if (confidence !== undefined && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
    return res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
  }

  const CONFIDENCE_THRESHOLD = 0.5;
  if (confidence !== undefined && confidence < CONFIDENCE_THRESHOLD) {
    return res.status(200).json({
      message: 'Prediction below confidence threshold, not saved',
      threshold: CONFIDENCE_THRESHOLD,
      received_confidence: confidence
    });
  }

  const translated = await translateText(sign, REGIONAL_LANGUAGE);

  const { data, error } = await supabase
    .from('messages')
    .insert([{
      meeting_id,
      sender_id: senderId,
      message_type: 'sign_translation',
      original_text: sign,
      translated_text: translated,
      language: language || 'en'
    }])
    .select()
    .single();

  if (error) {
    console.error('AI predict save error:', error.message);
    return res.status(500).json({ error: 'Failed to save prediction. Please try again.' });
  }

  const responseData = { ...data, sender_name: senderName };

  const io = req.app.get('io');
  if (io) {
    io.to(meeting_id).emit('sign-translation', responseData);
  }

  res.status(201).json({ message: 'Prediction saved', data: responseData });
});

module.exports = router;