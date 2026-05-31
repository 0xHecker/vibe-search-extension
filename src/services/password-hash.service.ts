const PBKDF2_ITERATIONS = 180_000;
const PBKDF2_DERIVED_BITS = 256;
const PBKDF2_ALGORITHM = "PBKDF2";
const HASH_ALGORITHM = "SHA-256";
const RECOVERY_PEPPER_FALLBACK = "vibe-search::private-recovery::v1";

export type PasswordHashRecord = {
  salt: string;
  hash: string;
  iterations: number;
};

export const DEFAULT_PASSWORD_ITERATIONS = PBKDF2_ITERATIONS;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const constantTimeEquals = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
};

const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
  // Bun/TS can model Uint8Array as ArrayBufferLike-backed; WebCrypto in strict mode
  // expects a concrete ArrayBuffer-backed BufferSource.
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const deriveHashBytes = async (
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> => {
  const passwordBytes = toArrayBuffer(new TextEncoder().encode(password));
  const saltBytes = toArrayBuffer(salt);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    PBKDF2_ALGORITHM,
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: PBKDF2_ALGORITHM,
      hash: HASH_ALGORITHM,
      salt: saltBytes,
      iterations,
    },
    keyMaterial,
    PBKDF2_DERIVED_BITS
  );
  return new Uint8Array(derived);
};

export const hashPassword = async (
  password: string,
  input?: {
    salt?: string;
    iterations?: number;
  }
): Promise<PasswordHashRecord> => {
  const salt =
    input?.salt !== undefined
      ? fromBase64(input.salt)
      : crypto.getRandomValues(new Uint8Array(16));
  const iterations = input?.iterations ?? PBKDF2_ITERATIONS;
  const hashBytes = await deriveHashBytes(password, salt, iterations);
  return {
    salt: toBase64(salt),
    hash: toBase64(hashBytes),
    iterations,
  };
};

export const verifyPassword = async (
  password: string,
  record: PasswordHashRecord
): Promise<boolean> => {
  if (!record.salt || !record.hash || !Number.isFinite(record.iterations)) {
    return false;
  }
  const derived = await hashPassword(password, {
    salt: record.salt,
    iterations: record.iterations,
  });
  return constantTimeEquals(fromBase64(derived.hash), fromBase64(record.hash));
};

const normalizeRecoveryAnswer = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const toRecoveryMaterial = (answer: string, pepper?: string): string =>
  `${normalizeRecoveryAnswer(answer)}::${pepper || RECOVERY_PEPPER_FALLBACK}`;

export const hashRecoveryAnswer = async (
  answer: string,
  input?: {
    salt?: string;
    iterations?: number;
    pepper?: string;
  }
): Promise<PasswordHashRecord> => {
  return hashPassword(toRecoveryMaterial(answer, input?.pepper), input);
};

export const verifyRecoveryAnswer = async (
  answer: string,
  record: PasswordHashRecord,
  input?: {
    pepper?: string;
  }
): Promise<boolean> => {
  return verifyPassword(toRecoveryMaterial(answer, input?.pepper), record);
};
