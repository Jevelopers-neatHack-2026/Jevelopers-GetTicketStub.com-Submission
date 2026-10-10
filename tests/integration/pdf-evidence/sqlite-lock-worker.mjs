import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';

const [databasePath, readyPath, releasedPath] = process.argv.slice(2);
const database = new DatabaseSync(databasePath, { timeout: 2_000 });
database.exec('PRAGMA trusted_schema = OFF; BEGIN IMMEDIATE');
writeFileSync(readyPath, 'locked', { flag: 'wx' });
setTimeout(() => {
  try {
    writeFileSync(releasedPath, 'released', { flag: 'wx' });
    database.exec('COMMIT');
  } finally {
    database.close();
  }
}, 350);
