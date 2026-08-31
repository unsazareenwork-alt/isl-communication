const supabase = require('./supabaseClient');

async function testAuth() {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'unsazareenwork+test1@gmail.com',
      password: 'Test1234!'
    });

    if (error) {
      console.log('❌ Auth error (but connection worked):', error.message);
    } else {
      console.log('✅ Auth successful!');
      console.log('Access token exists:', !!data.session?.access_token);
    }
  } catch (err) {
    console.log('❌ Fetch/network-level failure:', err.message);
    console.log('Full error:', err);
  }
}

testAuth();