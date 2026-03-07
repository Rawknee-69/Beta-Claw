import { describe, it, expect, beforeEach } from 'vitest';
import { E2EEncryption } from '../../src/security/e2e.js';
import type { KeyPair } from '../../src/security/e2e.js';

describe('E2EEncryption', () => {
  let e2e: E2EEncryption;
  let keyPair: KeyPair;

  beforeEach(() => {
    e2e = new E2EEncryption();
    keyPair = e2e.generateKeyPair();
  });

  it('generateKeyPair returns valid PEM keys', () => {
    expect(keyPair.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(keyPair.publicKey).toContain('-----END PUBLIC KEY-----');
    expect(keyPair.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(keyPair.privateKey).toContain('-----END PRIVATE KEY-----');
  });

  it('generateKeyPair produces unique key pairs', () => {
    const other = e2e.generateKeyPair();
    expect(other.publicKey).not.toBe(keyPair.publicKey);
    expect(other.privateKey).not.toBe(keyPair.privateKey);
  });

  it('encrypt returns base64 string', () => {
    const encrypted = e2e.encrypt('hello world', keyPair.publicKey);
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    const decoded = Buffer.from(encrypted, 'base64');
    expect(decoded.length).toBeGreaterThan(0);
  });

  it('encrypt/decrypt round-trip preserves message', () => {
    const message = 'The quick brown fox jumps over the lazy dog';
    const encrypted = e2e.encrypt(message, keyPair.publicKey);
    const decrypted = e2e.decrypt(encrypted, keyPair.privateKey);
    expect(decrypted).toBe(message);
  });

  it('encrypt/decrypt round-trip with unicode', () => {
    const message = '你好世界 🌍 مرحبا';
    const encrypted = e2e.encrypt(message, keyPair.publicKey);
    const decrypted = e2e.decrypt(encrypted, keyPair.privateKey);
    expect(decrypted).toBe(message);
  });

  it('decrypt fails with wrong private key', () => {
    const otherPair = e2e.generateKeyPair();
    const encrypted = e2e.encrypt('secret', keyPair.publicKey);
    expect(() => e2e.decrypt(encrypted, otherPair.privateKey)).toThrow();
  });

  it('sign returns base64 signature', () => {
    const signature = e2e.sign('test message', keyPair.privateKey);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });

  it('sign/verify round-trip succeeds', () => {
    const message = 'verify me';
    const signature = e2e.sign(message, keyPair.privateKey);
    const valid = e2e.verify(message, signature, keyPair.publicKey);
    expect(valid).toBe(true);
  });

  it('verify returns false for tampered message', () => {
    const signature = e2e.sign('original', keyPair.privateKey);
    const valid = e2e.verify('tampered', signature, keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it('verify returns false for tampered signature', () => {
    const signature = e2e.sign('message', keyPair.privateKey);
    const tamperedSig = Buffer.from(signature, 'base64');
    tamperedSig[0] = (tamperedSig[0]! ^ 0xff);
    const valid = e2e.verify('message', tamperedSig.toString('base64'), keyPair.publicKey);
    expect(valid).toBe(false);
  });

  it('verify fails with wrong public key', () => {
    const otherPair = e2e.generateKeyPair();
    const signature = e2e.sign('test', keyPair.privateKey);
    const valid = e2e.verify('test', signature, otherPair.publicKey);
    expect(valid).toBe(false);
  });

  it('encrypt validates empty message', () => {
    expect(() => e2e.encrypt('', keyPair.publicKey)).toThrow();
  });

  it('sign validates empty message', () => {
    expect(() => e2e.sign('', keyPair.privateKey)).toThrow();
  });
});
