const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, name, is_deaf_mute, preferred_language } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'email, password, and name are required' });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        is_deaf_mute: is_deaf_mute || false,
        preferred_language: preferred_language || 'en'
      }
    }
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({
    message: 'Signup successful',
    user: data.user,
    session: data.session
  });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({ error: error.message });
  }

  res.status(200).json({
    message: 'Login successful',
    user: data.user,
    session: data.session
  });
});

module.exports = router;