import jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

// Key paths
const KEYS_DIR = path.join(__dirname, '../../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

// Cached keys (loaded once at module initialization)
let _privateKey: string | null = null;
let _publicKey: string | null = null;

// Token configuration
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

import * as crypto from 'crypto';

export interface TokenPayload {
  userId: string;
  email: string;
  role?: string;
  tenantId?: string;
}

export interface RefreshTokenPayload extends TokenPayload {
  tokenId: string;
}

export interface DecodedToken extends TokenPayload {
  iat: number;
  exp: number;
}

export interface DecodedRefreshToken extends RefreshTokenPayload {
  iat: number;
  exp: number;
}

/**
 * Load private key for signing tokens (cached)
 */
function getPrivateKey(): string {
  if (!_privateKey) {
    // First check environment variable
    const envPrivateKey = process.env.JWT_PRIVATE_KEY;
    if (envPrivateKey && envPrivateKey.trim() !== '') {
      _privateKey = envPrivateKey;
    } else {
      // Fall back to disk
      if (!fs.existsSync(PRIVATE_KEY_PATH)) {
        throw new Error(
          'Private key not found. Run: pnpm generate-keys or set JWT_PRIVATE_KEY environment variable'
        );
      }
      _privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    }
  }
  return _privateKey;
}

/**
 * Load public key for verifying tokens (cached)
 */
function getPublicKey(): string {
  if (!_publicKey) {
    // First check environment variable
    const envPublicKey = process.env.JWT_PUBLIC_KEY;
    if (envPublicKey && envPublicKey.trim() !== '') {
      _publicKey = envPublicKey;
    } else {
      // Fall back to disk
      if (!fs.existsSync(PUBLIC_KEY_PATH)) {
        throw new Error(
          'Public key not found. Run: pnpm generate-keys or set JWT_PUBLIC_KEY environment variable'
        );
      }
      _publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    }
  }
  return _publicKey;
}

/**
 * Generate access token (short-lived)
 */
export function generateAccessToken(payload: TokenPayload): string {
  const privateKey = getPrivateKey();

  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_EXPIRY,
    issuer: 'ai-initializer',
    audience: 'ai-initializer-client',
  });
}

/**
 * Generate refresh token (long-lived) with unique tokenId
 */
export function generateRefreshToken(payload: TokenPayload): { token: string; tokenId: string } {
  const privateKey = getPrivateKey();
  const tokenId = crypto.randomUUID();

  const refreshPayload: RefreshTokenPayload = {
    ...payload,
    tokenId,
  };

  const token = jwt.sign(refreshPayload, privateKey, {
    algorithm: 'RS256',
    expiresIn: REFRESH_TOKEN_EXPIRY,
    issuer: 'ai-initializer',
    audience: 'ai-initializer-client',
  });

  return { token, tokenId };
}

/**
 * Generate both access and refresh tokens
 */
export function generateTokenPair(payload: TokenPayload): {
  accessToken: string;
  refreshToken: string;
  tokenId: string;
} {
  const { token: refreshToken, tokenId } = generateRefreshToken(payload);

  return {
    accessToken: generateAccessToken(payload),
    refreshToken,
    tokenId,
  };
}

/**
 * Verify and decode a token
 */
export function verifyToken(token: string): DecodedToken {
  const publicKey = getPublicKey();

  const decoded = jwt.verify(token, publicKey, {
    algorithms: ['RS256'],
    issuer: 'ai-initializer',
    audience: 'ai-initializer-client',
  });

  return decoded as DecodedToken;
}

/**
 * Decode token without verification (for debugging)
 */
export function decodeToken(token: string): TokenPayload | null {
  const decoded = jwt.decode(token);
  return decoded as TokenPayload | null;
}
