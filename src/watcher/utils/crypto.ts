import { createHmac, timingSafeEqual } from 'crypto';

export function computeHmacSignature(
  payload: string | Buffer,
  secret: string,
  algorithm: string = 'sha256'
): string {
  const hmac = createHmac(algorithm, secret);
  hmac.update(payload);
  return hmac.digest('hex');
}

export function verifyHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  algorithm: string = 'sha256',
  prefix?: string
): boolean {
  const expectedSignature = computeHmacSignature(payload, secret, algorithm);
  const fullExpectedSignature = prefix ? `${prefix}${expectedSignature}` : expectedSignature;

  if (signature.length !== fullExpectedSignature.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(fullExpectedSignature));
  } catch {
    return false;
  }
}
