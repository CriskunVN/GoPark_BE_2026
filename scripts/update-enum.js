const { Client } = require('pg');
require('dotenv').config();

async function updateEnum() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database.');
    
    // Check if 'PENDING' exists in the enum
    const checkQuery = `
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = 'parking_lots_status_enum'::regtype 
      AND enumlabel = 'PENDING';
    `;
    const res = await client.query(checkQuery);
    
    if (res.rows.length === 0) {
      console.log("Adding 'PENDING' to parking_lots_status_enum...");
      await client.query("ALTER TYPE parking_lots_status_enum ADD VALUE 'PENDING'");
      console.log("Successfully added 'PENDING' to enum.");
    } else {
      console.log("'PENDING' already exists in enum.");
    }
  } catch (err) {
    console.error('Error updating enum:', err);
  } finally {
    await client.end();
  }
}

updateEnum();
