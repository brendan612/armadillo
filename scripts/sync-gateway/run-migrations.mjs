import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

const databaseUrl = (process.env.SYNC_DATABASE_URL || '').trim()
if (!databaseUrl) {
  console.error('SYNC_DATABASE_URL is required')
  process.exit(1)
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const migrationPath = path.resolve(__dirname, '../../services/sync-gateway/migrations/001_init.sql')

const sql = await fs.readFile(migrationPath, 'utf8')
const client = new Client({ connectionString: databaseUrl })

try {
  await client.connect()
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('sync-gateway migrations applied')
} catch (error) {
  await client.query('ROLLBACK')
  console.error('sync-gateway migration failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end()
}
