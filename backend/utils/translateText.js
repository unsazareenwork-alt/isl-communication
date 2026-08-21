// Wraps the translation package with consistent error handling.
// If translation fails for any reason, we return null rather than throwing —
// so a translation hiccup never blocks saving the original message.

async function translateText(text, targetLang) {
  if (!text || !targetLang) return null;

  try {
    const { translate } = await import('@vitalets/google-translate-api');
    const result = await translate(text, { to: targetLang });
    return result.text;
  } catch (err) {
    console.error(`Translation failed (target: ${targetLang}):`, err.message);
    return null;
  }
}

module.exports = translateText;