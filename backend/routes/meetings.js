const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { customAlphabet } = require('nanoid');

const generateCode = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 4);

function makeMeetingCode() {
  return `${generateCode()}-${generateCode()}-${generateCode()}`;
}

// POST /api/meetings/create
router.post('/create', authMiddleware, async (req, res) => {
  const hostId = req.user.id;
  const meetingCode = makeMeetingCode();

  const { data, error } = await supabase
    .from('meetings')
    .insert([{ host_id: hostId, meeting_code: meetingCode, status: 'active' }])
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ message: 'Meeting created', meeting: data });
});

// POST /api/meetings/join/:code
router.post('/join/:code', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { code } = req.params;

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('meeting_code', code)
    .eq('status', 'active')
    .single();

  if (meetingError || !meeting) {
    return res.status(404).json({ error: 'Meeting not found or not active' });
  }

  const { data: participant, error: joinError } = await supabase
    .from('meeting_participants')
    .insert([{ meeting_id: meeting.id, user_id: userId }])
    .select()
    .single();

  if (joinError) {
    return res.status(400).json({ error: joinError.message });
  }

  res.status(200).json({ message: 'Joined meeting', meeting, participant });
});

// POST /api/meetings/end/:id
router.post('/end/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: meeting, error: fetchError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }

  if (meeting.host_id !== userId) {
    return res.status(403).json({ error: 'Only the host can end this meeting' });
  }

  const { data, error } = await supabase
    .from('meetings')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(200).json({ message: 'Meeting ended', meeting: data });
});

module.exports = router;