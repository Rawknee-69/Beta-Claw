import {
  generateKeyPairSync,
  publicEncrypt,
  privateDecrypt,
  sign as cryptoSign,
  verify as cryptoVerify,
  constants,
} from 'node:crypto';
import { z } from 'zod';

const KeyPairSchema = z.object({
  publicKey: z.string().startsWith('-----BEGIN PUBLIC KEY-----'),
  privateKey: z.string().startsWith('-----BEGIN PRIVATE KEY-----'),
});

const KEY_SIZE = 2048;

interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export class E2EEncryption {
  generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: KEY_SIZE,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    return KeyPairSchema.parse({ publicKey, privateKey });
  }

  encrypt(message: string, recipientPublicKey: string): string {
    const MessageSchema = z.string().min(1);
    MessageSchema.parse(message);
    z.string().min(1).parse(recipientPublicKey);

    const buffer = Buffer.from(message, 'utf-8');
    const encrypted = publicEncrypt(
      {
        key: recipientPublicKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );

    return encrypted.toString('base64');
  }

  decrypt(encrypted: string, privateKey: string): string {
    z.string().min(1).parse(encrypted);
    z.string().min(1).parse(privateKey);

    const buffer = Buffer.from(encrypted, 'base64');
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );

    return decrypted.toString('utf-8');
  }

  sign(message: string, privateKey: string): string {
    z.string().min(1).parse(message);
    z.string().min(1).parse(privateKey);

    const signature = cryptoSign('sha256', Buffer.from(message, 'utf-8'), {
      key: privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
    });

    return signature.toString('base64');
  }

  verify(message: string, signature: string, publicKey: string): boolean {
    z.string().parse(message);
    z.string().min(1).parse(signature);
    z.string().min(1).parse(publicKey);

    return cryptoVerify(
      'sha256',
      Buffer.from(message, 'utf-8'),
      {
        key: publicKey,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      Buffer.from(signature, 'base64'),
    );
  }
}

export type { KeyPair };
