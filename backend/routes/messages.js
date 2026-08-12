const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');

// POST /api/messages
router.post('/', authMiddleware, async (req, res) => {
  const senderId = req.user.id;
  const { meeting_id, message_type, original_text, translated_text, language } = req.body;

  if (!meeting_id || !message_type || !original_text) {
    return res.status(400).json({ error: 'meeting_id, message_type, and original_text are required' });
  }

  const validTypes = ['chat', 'sign_translation', 'speech_translation'];
  if (!validTypes.includes(message_type)) {
    return res.status(400).json({ error: `message_type must be one of: ${validTypes.join(', ')}` });
  }

  const { data, error } = await supabase
    .from('messages')
    .insert([{
      meeting_id,
      sender_id: senderId,
      message_type,
      original_text,
      translated_text: translated_text || null,
      language: language || 'en'
    }])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ message: 'Message saved', data });
});

// GET /api/messages/:meetingId
router.get('/:meetingId', authMiddleware, async (req, res) => {
  const { meetingId } = req.params;

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(200).json({ messages: data });
});

module.exports = router;