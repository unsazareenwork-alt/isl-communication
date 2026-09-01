// Translation for the demo: a manually verified glossary, not a live API call.
// This is deliberate — the demo vocabulary is small and known in advance (27 words),
// so a fixed, correct glossary is far more reliable than a live translation service
// (which was returning rate-limit errors, and separately, low-quality/incorrect
// results for short common words). No network call, no rate limit, no risk of
// nonsensical output during a live demo.
//
// IMPORTANT: Have a Tamil speaker review this list before demo day.
// Marked with (?) are words with more than one reasonable option — worth confirming.

const GLOSSARY = {
  ta: {
    'drink': 'குடி',
    'eat': 'சாப்பிடு',
    'father': 'அப்பா',
    'food': 'உணவு',
    'friend': 'நண்பர்',              // (?) gender-neutral form used — நண்பன்/தோழி are gendered alternatives
    'go': 'போ',
    'he': 'அவன்',
    'hello': 'வணக்கம்',
    'help': 'உதவி',
    'market': 'சந்தை',
    'mother': 'அம்மா',
    'no': 'இல்லை',
    'please': 'தயவுசெய்து',
    'school': 'பள்ளி',
    'she': 'அவள்',
    'sister': 'சகோதரி',              // (?) அக்கா (elder) / தங்கை (younger) are more specific alternatives
    'sit': 'உட்கார்',
    'student': 'மாணவர்',             // gender-neutral form
    'tea': 'தேநீர்',
    'teacher': 'ஆசிரியர்',
    'thank_you': 'நன்றி',
    'today': 'இன்று',
    'water': 'தண்ணீர்',
    'what': 'என்ன',
    'where': 'எங்கே',
    'yes': 'ஆம்',
    'you': 'நீ'                      // (?) நீங்கள் is the formal/plural alternative
  }
};

async function translateText(text, targetLang) {
  if (!text || !targetLang) return null;

  const languageGlossary = GLOSSARY[targetLang];
  if (!languageGlossary) return null;

  const normalized = text.trim().toLowerCase().replace(/\s+/g, '_');
  const translated = languageGlossary[normalized];

  if (!translated) {
    // Word not in our verified demo vocabulary — deliberately return null
    // rather than risk an unreliable live translation showing something wrong.
    console.log(`No glossary entry for "${text}" (${targetLang}) — word outside current demo vocabulary`);
    return null;
  }

  return translated;
}

module.exports = translateText;