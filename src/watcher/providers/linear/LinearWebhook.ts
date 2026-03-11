import { createHmac, timingSafeEqual } from 'crypto';

export class LinearWebhook {
  constructor(private readonly secret?: string) {}

  validate(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): { valid: boolean; error?: string } {
    const webhookId = this.getHeader(headers, 'linear-delivery');

    if (!webhookId) {
      return { valid: false, error: 'Missing Linear-Delivery header' };
    }

    // Verify signature if secret is configured
    if (this.secret) {
      const signature = this.getHeader(headers, 'linear-signature');

      if (!signature) {
        return { valid: false, error: 'Missing Linear-Signature header' };
      }

      const isValid = this.verifySignature(signature, rawBody);

      if (!isValid) {
        return { valid: false, error: 'Invalid webhook signature' };
      }
    }

    return { valid: true };
  }

  private verifySignature(signature: string, body: string | Buffer): boolean {
    if (!this.secret) {
      return false;
    }

    // Compute HMAC SHA-256
    const hmac = createHmac('sha256', this.secret);
    const bodyString = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    hmac.update(bodyString);
    const computedSignature = hmac.digest('hex');

    // Timing-safe comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computedSignature, 'hex'));
    } catch {
      // timingSafeEqual throws if buffers have different lengths
      return false;
    }
  }

  extractMetadata(headers: Record<string, string | string[] | undefined>): { webhookId: string } {
    const webhookId = this.getHeader(headers, 'linear-delivery');

    if (!webhookId) {
      throw new Error('Missing required Linear webhook headers');
    }

    return { webhookId };
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string
  ): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
