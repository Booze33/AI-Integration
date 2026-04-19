import bcrypt from 'bcryptjs';

async function generateHashes() {
  const passwords = {
    'alice@acme.com': 'AdminPass123!',
    'bob@acme.com': 'AdminPass123!',
    'charlie@acme.com': 'UserPass123!',
    'diana@techstart.io': 'AdminPass123!',
    'eve@techstart.io': 'UserPass123!',
    'frank@trial.co': 'UserPass123!',
  };

  console.log('Generating bcrypt password hashes (salt rounds: 12)...\n');

  for (const [email, password] of Object.entries(passwords)) {
    const hash = await bcrypt.hash(password, 12);
    console.log(`Email: ${email}`);
    console.log(`Hash: ${hash}\n`);
  }
}

generateHashes().catch(console.error);
