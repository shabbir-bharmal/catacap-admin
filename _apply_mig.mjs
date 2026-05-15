import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const sql = fs.readFileSync('releases/15_05_2026/migrations/2026_05_15_testimonials_soft_delete.sql', 'utf8');
const c = await pool.connect();
try {
  const before = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='testimonials' AND column_name IN ('is_deleted','deleted_at','deleted_by') ORDER BY column_name`);
  console.log('BEFORE columns:', before.rows.map(r=>r.column_name));
  await c.query(sql);
  const after = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='testimonials' AND column_name IN ('is_deleted','deleted_at','deleted_by') ORDER BY column_name`);
  console.log('AFTER columns:', after.rows);
  const cnt = await c.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_deleted = true)::int AS deleted FROM testimonials`);
  console.log('Row stats:', cnt.rows[0]);
} finally { c.release(); await pool.end(); }
