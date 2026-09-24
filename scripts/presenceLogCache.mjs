// Keep the raw presence log out of public view between runs.
//
// The log names which rostered players were in Rocket League at every poll,
// a few minutes apart. The board only needs the hours worked out from it, so
// the log itself is no longer published to the data branch. It is carried from
// one presence run to the next in the Actions cache instead.
//
// Caches written on main can be restored by pull requests, including ones from
// forks, and a fork's run never sees the repository's secrets. So the cached
// file is sealed with AES-256-GCM under a key derived from the
// PRESENCE_LOG_KEY secret: without the key the bytes say nothing, and GCM's
// tag means a wrong key or a damaged file is detected rather than misread.
//
//   node scripts/presenceLogCache.mjs open    sealed cache copy -> data/presence/log.jsonl
//   node scripts/presenceLogCache.mjs seal    data/presence/log.jsonl -> sealed cache copy
//
// Neither ever fails the run. A missing key, a cache miss or a copy that will
// not open all mean the same thing, starting a fresh log, and the log output
// says which one it was. A fresh log undercounts the hidden-hours estimates
// until it has built up two weeks again, which is the whole cost.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// Format: MAGIC, 12-byte nonce, 16-byte tag, ciphertext.
const MAGIC = Buffer.from("RLPL1");
const NONCE = 12;
const TAG = 16;

// The secret as typed may be any length, so it is hashed down to the 32 bytes
// AES-256 takes. It is expected to be long and random (openssl rand -hex 32).
const keyOf = (secret) => createHash("sha256").update(String(secret)).digest();

/**
 * The log, compressed and then sealed under the secret. A fresh nonce on
 * every call.
 *
 * Compressed first because a new cache entry is saved on every run, every
 * two minutes, and the log is about 2.6 MB of repetitive JSON lines: gzip
 * takes it to roughly a tenth. Encrypting first would leave nothing for gzip
 * to find.
 */
export function seal(plain, secret) {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", keyOf(secret), nonce);
  const body = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
}

/** The log, or null when the bytes are not a copy this secret sealed. */
export function unseal(sealed, secret) {
  if (!Buffer.isBuffer(sealed) || sealed.length < MAGIC.length + NONCE + TAG) return null;
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE);
  const tag = sealed.subarray(MAGIC.length + NONCE, MAGIC.length + NONCE + TAG);
  const body = sealed.subarray(MAGIC.length + NONCE + TAG);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), nonce);
    decipher.setAuthTag(tag);
    return gunzipSync(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
  const LOG = join(ROOT, "data", "presence", "log.jsonl");
  // Outside data/ on purpose, so no publish step can ever pick it up.
  const SEALED = join(ROOT, ".presence-cache", "log.sealed");
  const secret = (process.env.PRESENCE_LOG_KEY ?? "").trim();
  const mode = process.argv[2];

  if (mode === "open") {
    // Whatever happens below, the run starts from the cache or from nothing,
    // never from a copy left over from somewhere else.
    await rm(LOG, { force: true });
    await mkdir(dirname(LOG), { recursive: true });
    const sealed = await readFile(SEALED).catch(() => null);
    // A one-time handover. Before this change the log lived on the data
    // branch, so the first run after it has no cached copy yet. Starting
    // fresh then would throw away two weeks of polls and blank the
    // hidden-hours estimates for a fortnight. PRESENCE_LOG_SEED names the data
    // branch's last copy; it is only read when there is no cached copy at all,
    // and once that copy is deleted from the branch this does nothing.
    const seed = process.env.PRESENCE_LOG_SEED
      ? await readFile(join(ROOT, process.env.PRESENCE_LOG_SEED)).catch(() => null)
      : null;
    if (!sealed && seed) {
      await writeFile(LOG, seed);
      console.log(`presence log: no cached copy yet; took over the data branch copy, ${seed.toString("utf8").split("\n").filter(Boolean).length} polls`);
    } else if (!secret) {
      console.log("presence log: PRESENCE_LOG_KEY is not set, so the cached log cannot be opened; starting a fresh log");
    } else if (!sealed) {
      console.log("presence log: no cached copy found; starting a fresh log");
    } else {
      const plain = unseal(sealed, secret);
      if (!plain) {
        console.log("presence log: the cached copy could not be decrypted (wrong key or damaged file); starting a fresh log");
      } else {
        await writeFile(LOG, plain);
        console.log(`presence log: opened the cached copy, ${plain.toString("utf8").split("\n").filter(Boolean).length} polls`);
      }
    }
  } else if (mode === "seal") {
    await rm(SEALED, { force: true });
    const plain = await readFile(LOG).catch(() => null);
    if (!secret) {
      console.log("presence log: PRESENCE_LOG_KEY is not set; the log is not cached, and the next run starts fresh");
    } else if (!plain) {
      console.log("presence log: nothing to cache");
    } else {
      await mkdir(dirname(SEALED), { recursive: true });
      await writeFile(SEALED, seal(plain, secret));
      console.log("presence log: sealed for the cache");
    }
  } else {
    console.error("usage: node scripts/presenceLogCache.mjs open|seal");
    process.exit(1);
  }
}
