require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

// Use the HTTP fetch-based connection (not WebSocket/SCRAM)
const sql = neon(process.env.DATABASE_URL, { 
  fetchOptions: { cache: 'no-store' }
});

async function test() {
  try {
    console.log('Testing connection...');
    const result = await sql`SELECT 1 as connected`;
    console.log('Connected!', JSON.stringify(result));
  } catch (err) {
    console.error('Error:', err.message, err.stack);
  }
}
test();
