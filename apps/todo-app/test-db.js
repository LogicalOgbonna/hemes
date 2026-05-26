
require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

client.connect()
  .then(() => {
    console.log('CONNECTED');
    return client.query('SELECT 1');
  })
  .then(res => { console.log('QUERY OK:', res.rows); return client.end(); })
  .then(() => console.log('SUCCESS'))
  .catch(err => { console.error('FAIL:', err.message); process.exit(1); });
