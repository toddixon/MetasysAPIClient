import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..');

for (const envPath of [path.join(packageRoot, '.env'), path.join(repoRoot, '.env')]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? '3000'),
  apiPrefix: '/api/v6',
  dbPath: process.env.DB_PATH ?? path.join(packageRoot, 'data', 'metasys-mock.db'),
  liveSyncOnRead: parseBooleanEnv(process.env.METASYS_SYNC_ON_READ),
  repoRoot,
  referencesRoot: path.join(repoRoot, 'references'),
  referencesDataDir: path.join(repoRoot, 'references', 'data'),
};
