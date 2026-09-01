const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { customAlphabet } = require('nanoid');
const { isValidUUID } = require('../utils/validate');

const generateCode = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 4);

function makeMeetingCode() {
  return `${generateCode()}-${generateCode()}-${generateCode()}`;
}

// POST /api/meetings/create
router.post('/create', authMiddleware, async (req, res) => {
  const hostId = req.user.id;
  const meetingCode = makeMeetingCode();

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .insert([{ host_id: hostId, meeting_code: meetingCode, status: 'active' }])
    .select()
    .single();

  if (meetingError) {
    console.error('Create meeting error:', meetingError.message);
    return res.status(500).json({ error: 'Failed to create meeting. Please try again.' });
  }

  const { error: participantError } = await supabase
    .from('meeting_participants')
    .insert([{ meeting_id: meeting.id, user_id: hostId }]);

  if (participantError) {
    console.error('Auto-join host error:', participantError.message);
    return res.status(500).json({ error: 'Meeting created but failed to register host as participant.' });
  }

  res.status(201).json({ message: 'Meeting created', meeting });
});

// POST /api/meetings/join/:code
router.post('/join/:code', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { code } = req.params;

  if (typeof code !== 'string' || code.length < 3 || code.length > 50) {
    return res.status(400).json({ error: 'Invalid meeting code' });
  }

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
    console.error('Join meeting error:', joinError.message);
    return res.status(500).json({ error: 'Failed to join meeting. Please try again.' });
  }

  res.status(200).json({ message: 'Joined meeting', meeting, participant });
});

// POST /api/meetings/leave/:id
router.post('/leave/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'id must be a valid meeting UUID' });
  }

  const { data, error } = await supabase
    .from('meeting_participants')
    .update({ left_at: new Date().toISOString() })
    .eq('meeting_id', id)
    .eq('user_id', userId)
    .is('left_at', null)
    .select()
    .maybeSingle();

  if (error) {
    console.error('Leave meeting error:', error.message);
    return res.status(500).json({ error: 'Failed to update leave status. Please try again.' });
  }

  if (!data) {
    return res.status(404).json({ error: 'No active participation found for this user in this meeting' });
  }

  // Notify others in the room that this specific participant left
  // (covers the case where the frontend calls this endpoint but the
  // socket disconnect event hasn't fired yet, or fires separately)
  const io = req.app.get('io');
  if (io) {
    io.to(id).emit('user-left', {
      userId,
      message: 'A participant has left the meeting'
    });
  }

  res.status(200).json({ message: 'Left meeting', participant: data });
});

// POST /api/meetings/end/:id
router.post('/end/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!isValidUUID(id)) {
    return res.status(400).json({ error: 'id must be a valid meeting UUID' });
  }

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
    console.error('End meeting error:', error.message);
    return res.status(500).json({ error: 'Failed to end meeting. Please try again.' });
  }

  // Notify EVERY participant currently in the meeting room that it has ended,
  // so their clients can automatically disconnect and close their video calls —
  // not just the host who clicked "End Meeting."
  const io = req.app.get('io');
  if (io) {
    io.to(id).emit('meeting-ended', {
      message: 'This meeting has been ended by the host',
      meetingId: id,
      endedAt: data.ended_at
    });
  }

  res.status(200).json({ message: 'Meeting ended', meeting: data });
});

module.exports = router;