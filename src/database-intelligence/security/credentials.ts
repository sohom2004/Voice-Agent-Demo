import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16

function getEncryptionKey(): Buffer {
  const envKey = process.env.DB_INTEL_ENCRYPTION_KEY;
  console.log('[Crypto DEBUG] DB_INTEL_ENCRYPTION_KEY env var:', envKey ? `defined, length: ${envKey.length}` : 'undefined');
  if (envKey && envKey.trim() !== '') {
    if (envKey.length === 32) {
      const buf = Buffer.from(envKey, 'utf8');
      console.log('[Crypto DEBUG] Key buffer length (32-char utf8):', buf.length);
      return buf;
    }
    if (envKey.length === 64) {
      const buf = Buffer.from(envKey, 'hex');
      console.log('[Crypto DEBUG] Key buffer length (64-char hex):', buf.length);
      return buf;
    }
    const buf = crypto.createHash('sha256').update(envKey).digest();
    console.log('[Crypto DEBUG] Key buffer length (sha256 digest):', buf.length);
    return buf;
  }
  
  const fallback = 'db-intel-32-chars-secret-key!!!!';
  const buf = Buffer.from(fallback, 'utf8');
  console.log('[Crypto DEBUG] Key buffer length (fallback):', buf.length);
  return buf;
}

/**
 * Encrypts a plaintext string (like a database password or JSON configuration block).
 */
export function encryptCredentials(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return IV concatenated with ciphertext, separated by colon
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts a previously encrypted credentials string.
 */
export function decryptCredentials(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted credentials format. Expected "iv:ciphertext"');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = Buffer.from(parts[1], 'hex');
  const key = getEncryptionKey();
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  
  let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
