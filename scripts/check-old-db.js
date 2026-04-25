const { Client } = require('pg');
require('dotenv').config();

async function checkOldDB() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL_OLD,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to OLD database.');
    
    const query = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vehicles';
    `;
    const res = await client.query(query);
    console.log('Columns in OLD vehicles table:');
    res.rows.forEach(row => console.log(`- ${row.column_name}`));
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

checkOldDB();
