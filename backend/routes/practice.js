const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');
const authMiddleware = require('../middleware/authMiddleware');
const { isNonEmptyString } = require('../utils/validate');

const POINTS_PER_CORRECT = 10;

// GET /api/practice/signs
// Returns the available signs (word + reference image) for the Learn screen.
router.get('/signs', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('signs')
    .select('word, image_url')
    .order('word', { ascending: true });

  if (error) {
    console.error('Fetch signs error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch signs. Please try again.' });
  }

  res.status(200).json({ signs: data });
});

// POST /api/practice/attempt
// Body: { target_word, recognized_word, confidence }
// Checks the AI's recognized word against the target word, saves the
// attempt, and returns whether it was correct plus the user's updated score.
router.post('/attempt', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { target_word, recognized_word, confidence } = req.body || {};

  if (!isNonEmptyString(target_word, 200)) {
    return res.status(400).json({ error: 'target_word is required and must be non-empty text' });
  }

  if (recognized_word !== undefined && recognized_word !== null && typeof recognized_word !== 'string') {
    return res.status(400).json({ error: 'recognized_word must be a string if provided' });
  }

  if (confidence !== undefined && confidence !== null && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)) {
    return res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
  }

  const normalizedTarget = target_word.trim().toLowerCase();
  const normalizedRecognized = (recognized_word || '').trim().toLowerCase();
  const isCorrect = normalizedRecognized.length > 0 && normalizedRecognized === normalizedTarget;

  const { data: attempt, error: insertError } = await supabase
    .from('practice_attempts')
    .insert([{
      user_id: userId,
      target_word: normalizedTarget,
      recognized_word: recognized_word || null,
      confidence: confidence ?? null,
      is_correct: isCorrect
    }])
    .select()
    .single();

  if (insertError) {
    console.error('Save practice attempt error:', insertError.message);
    return res.status(500).json({ error: 'Failed to save attempt. Please try again.' });
  }

  const { count: correctCount, error: countError } = await supabase
    .from('practice_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_correct', true);

  if (countError) {
    console.error('Fetch score error:', countError.message);
    // Attempt was saved successfully even if the score lookup failed —
    // return the result without a score rather than a hard failure.
    return res.status(201).json({ correct: isCorrect, attempt, score: null });
  }

  const score = (correctCount || 0) * POINTS_PER_CORRECT;

  res.status(201).json({ correct: isCorrect, attempt, score });
});

// GET /api/practice/score
// Returns the current user's total practice score.
router.get('/score', authMiddleware, async (req, res) => {
  const userId = req.user.id;

  const { count, error } = await supabase
    .from('practice_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_correct', true);

  if (error) {
    console.error('Fetch score error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch score. Please try again.' });
  }

  res.status(200).json({ score: (count || 0) * POINTS_PER_CORRECT });
});

module.exports = router;