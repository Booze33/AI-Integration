import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate RSA keypair for JWT RS256 signing
 * - Private key: Used for signing tokens (keep secret!)
 * - Public key: Used for verifying tokens (can be shared)
 */

const KEYS_DIR = path.join(__dirname, '../../keys');

function generateKeyPair() {
  // Create keys directory if it doesn't exist
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Generate RSA keypair with 2048-bit key size
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Write keys to files
  const privateKeyPath = path.join(KEYS_DIR, 'private.pem');
  const publicKeyPath = path.join(KEYS_DIR, 'public.pem');

  fs.writeFileSync(privateKeyPath, privateKey);
  fs.writeFileSync(publicKeyPath, publicKey);

  // Set restrictive permissions on private key (Unix-like systems)
  try {
    fs.chmodSync(privateKeyPath, 0o600);
  } catch {
    // Windows doesn't support chmod the same way
    console.warn('Note: Could not set file permissions (Windows system)');
  }

  console.log('✅ RSA keypair generated successfully!');
  console.log(`📁 Private key: ${privateKeyPath}`);
  console.log(`📁 Public key: ${publicKeyPath}`);
  console.log('');
  console.log('⚠️  IMPORTANT:');
  console.log('   - Keep private.pem SECRET (used for signing tokens)');
  console.log('   - public.pem can be shared (used for verifying tokens)');
  console.log('   - Add keys/ to .gitignore');
}

// Run if executed directly
if (require.main === module) {
  generateKeyPair();
}

export { generateKeyPair };
