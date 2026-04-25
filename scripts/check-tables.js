const { Client } = require('pg');
require('dotenv').config();

async function checkTables() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database.');
    
    const query = `
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'vehicles';
    `;
    const res = await client.query(query);
    console.log('Tables named "vehicles":');
    res.rows.forEach(row => console.log(`- ${row.table_schema}.${row.table_name}`));
    
  } catch (err) {
    console.error('Error checking tables:', err);
  } finally {
    await client.end();
  }
}

checkTables();
