const { Client } = require('pg');
require('dotenv').config();

async function testInsert() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database.');
    
    console.log("Inserting test row...");
    const res = await client.query(
      "INSERT INTO vehicles (plate_number, owner_name, brand, type, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      ['TEST-123', 'John Doe', 'Toyota', 'SUV', '019d1fbc-2c1a-7c4c-b75b-bd7fc875be16']
    );
    const id = res.rows[0].id;
    console.log(`Inserted row with ID: ${id}`);
    
    console.log("Deleting test row...");
    await client.query("DELETE FROM vehicles WHERE id = $1", [id]);
    console.log("Deleted test row.");
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

testInsert();
