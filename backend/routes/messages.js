const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { isValidUUID, isNonEmptyString } = require('../utils/validate');
const translateText = require('../utils/translateText');

const VALID_MESSAGE_TYPES = ['chat', 'sign_translation', 'speech_translation'];
const REGIONAL_LANGUAGE = 'ta'; // Tamil, per team decision — matches ai.js

// POST /api/messages
router.post('/', authMiddleware, async (req, res) => {
  const senderId = req.user.id;
  const { meeting_id, message_type, original_text, translated_text, language } = req.body;

  if (!isValidUUID(meeting_id)) {
    return res.status(400).json({ error: 'meeting_id must be a valid UUID' });
  }

  if (!VALID_MESSAGE_TYPES.includes(message_type)) {
    return res.status(400).json({ error: `message_type must be one of: ${VALID_MESSAGE_TYPES.join(', ')}` });
  }

  if (!isNonEmptyString(original_text)) {
    return res.status(400).json({ error: 'original_text is required and must be non-empty text' });
  }

  if (translated_text !== undefined && translated_text !== null && !isNonEmptyString(translated_text)) {
    return res.status(400).json({ error: 'translated_text must be non-empty text if provided' });
  }

  if (language !== undefined && (typeof language !== 'string' || language.length > 10)) {
    return res.status(400).json({ error: 'language must be a short language code (e.g. "en", "hi")' });
  }

  // Auto-translate speech_translation messages into the regional language,
  // unless the caller already supplied their own translated_text.
  let finalTranslatedText = translated_text || null;
  if (message_type === 'speech_translation' && !finalTranslatedText) {
    finalTranslatedText = await translateText(original_text, REGIONAL_LANGUAGE);
  }

  const { data, error } = await supabase
    .from('messages')
    .insert([{
      meeting_id,
      sender_id: senderId,
      message_type,
      original_text,
      translated_text: finalTranslatedText,
      language: language || 'en'
    }])
    .select()
    .single();

  if (error) {
    console.error('Insert message error:', error.message);
    return res.status(500).json({ error: 'Failed to save message. Please try again.' });
  }

  // Broadcast live to everyone in this meeting's room — same pattern as /api/ai/predict
  const io = req.app.get('io');
  if (io) {
    io.to(meeting_id).emit('new-message', data);
  }

  res.status(201).json({ message: 'Message saved', data });
});

// GET /api/messages/:meetingId
router.get('/:meetingId', authMiddleware, async (req, res) => {
  const { meetingId } = req.params;

  if (!isValidUUID(meetingId)) {
    return res.status(400).json({ error: 'meetingId must be a valid UUID' });
  }

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Fetch messages error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch messages. Please try again.' });
  }

  res.status(200).json({ messages: data });
});

module.exports = router;