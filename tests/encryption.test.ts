import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../lib/security/encryption";

describe("SSN Encryption / Decryption", () => {
  it("should decrypt an encrypted value back to the original", () => {
    const original = "123-45-6789";
    const encrypted = encrypt(original);

    expect(encrypted).not.toBe(original);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  // having identical encrypted entries in a database provides valuable info to bad actors
  it("should produce different ciphertexts even for the same input", () => {
    const value = "987-65-4321";
    const enc1 = encrypt(value);
    const enc2 = encrypt(value);

    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(value);
    expect(decrypt(enc2)).toBe(value);
  });
});
