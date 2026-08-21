const { translate } = require('@vitalets/google-translate-api');

async function testTranslation() {
  try {
    const result = await translate('HELP', { to: 'ta' }); // 'ta' = Tamil
    console.log('✅ Translation successful!');
    console.log('Original:', 'HELP');
    console.log('Translated (Tamil):', result.text);
  } catch (err) {
    console.error('❌ Translation failed:', err.message);
  }
}

testTranslation();