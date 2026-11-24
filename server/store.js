// Metadata store + blob store. Blobs use an S3-style bucket/key layout on local disk
// so the adapter can be swapped for a real S3-compatible backend (Ceph RGW, SeaweedFS,
// Garage, ...) without changing the API layer. Metadata is a JSON file for the demo;
// production would use PostgreSQL.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createBlobStore(dataDir, bucket = 'fairdoc-documents') {
  const root = path.join(dataDir, 's3', bucket);
  return {
    put(key, buf) {
      const p = path.join(root, key);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, buf);
      return { bucket, key, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    },
    get(key) { return fs.readFileSync(path.join(root, key)); },
  };
}

export function createMetaStore(dataDir) {
  const file = path.join(dataDir, 'meta.json');
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { collections: {}, documents: {} };
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  const id = (p) => `${p}_${crypto.randomBytes(6).toString('hex')}`;
  return { db, save, id };
}
