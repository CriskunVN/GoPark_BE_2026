const { Client } = require('pg');
require('dotenv').config();

async function testQuery() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database.');
    
    console.log("Testing query: SELECT owner_name FROM vehicles LIMIT 1");
    const res = await client.query("SELECT owner_name FROM vehicles LIMIT 1");
    console.log("Success! Data:", res.rows);
    
  } catch (err) {
    console.error('Error in test query:', err.message);
  } finally {
    await client.end();
  }
}

testQuery();
