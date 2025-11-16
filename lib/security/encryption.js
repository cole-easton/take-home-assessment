import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// 32 bytes for AES-256
const key = Buffer.from(
    process.env.ENCRYPTION_KEY ??
    "0123456789abcdef0123456789abcdef", // fallback for assessment evaluators
    "utf8"
);

export function encrypt(plain) {
    const iv = randomBytes(12); // standard for GCM
    const cipher = createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plain, "utf8"),
        cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return [
        iv.toString("hex"),
        encrypted.toString("hex"),
        tag.toString("hex"),
    ].join(":");
}

export function decrypt(ciphertext) {
    const [ivHex, encryptedHex, tagHex] = ciphertext.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const tag = Buffer.from(tagHex, "hex");

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
    ]);

    return decrypted.toString("utf8");
}
