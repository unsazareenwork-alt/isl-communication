// Translation helper using MyMemory Translation API (free, no API key needed).
// Includes an in-memory cache so repeated words (common in a small curated
// demo vocabulary) don't need a fresh network call every time — this also
// protects against rate limits on any single translation provider.

const cache = new Map(); // key: "text::lang", value: translated text

async function translateText(text, targetLang) {
  if (!text || !targetLang) return null;

  const cacheKey = `${text.toLowerCase()}::${targetLang}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;
    const response = await fetch(url);
    const data = await response.json();

    const translated = data?.responseData?.translatedText;

    if (!translated || data.responseStatus !== 200) {
      console.error(`Translation failed (target: ${targetLang}): unexpected response`, data?.responseStatus);
      return null;
    }

    cache.set(cacheKey, translated);
    return translated;
  } catch (err) {
    console.error(`Translation failed (target: ${targetLang}):`, err.message);
    return null;
  }
}

module.exports = translateText;