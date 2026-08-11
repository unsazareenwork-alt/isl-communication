const supabase = require('./supabaseClient');

async function testConnection() {
  const { data, error } = await supabase
    .from('_test_connection_check')
    .select('*')
    .limit(1);

  if (error) {
    if (error.code === 'PGRST205' || error.message.includes('does not exist')) {
      console.log('✅ Connected to Supabase successfully!');
      console.log('(No tables yet — that error is expected since we haven\'t created any.)');
    } else {
      console.log('❌ Connection error:', error.message);
    }
  } else {
    console.log('✅ Connected to Supabase successfully!');
    console.log(data);
  }
}

testConnection();