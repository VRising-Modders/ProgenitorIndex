import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The checkout that holds these tools. Schemas and the download cache live here.
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = process.env.INDEX_CACHE_DIR ? resolve(process.env.INDEX_CACHE_DIR) : join(ROOT, '.cache');
