import { createHmac, timingSafeEqual } from 'crypto';

export class GitHubWebhook {
  constructor(private readonly secret?: string) {}

  validate(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): { valid: boolean; error?: string } {
    const event = this.getHeader(headers, 'x-github-event');
    const deliveryId = this.getHeader(headers, 'x-github-delivery');

    if (!event) {
      return { valid: false, error: 'Missing X-GitHub-Event header' };
    }

    if (!deliveryId) {
      return { valid: false, error: 'Missing X-GitHub-Delivery header' };
    }

    // Verify signature if secret is configured
    if (this.secret) {
      const signature = this.getHeader(headers, 'x-hub-signature-256');

      if (!signature) {
        return { valid: false, error: 'Missing X-Hub-Signature-256 header' };
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

    // GitHub signature format: sha256=<hex>
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const expectedSignature = signature.slice(7); // Remove 'sha256=' prefix

    // Compute HMAC SHA-256
    const hmac = createHmac('sha256', this.secret);
    const bodyString = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    hmac.update(bodyString);
    const computedSignature = hmac.digest('hex');

    // Timing-safe comparison to prevent timing attacks
    try {
      return timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(computedSignature, 'hex')
      );
    } catch {
      // timingSafeEqual throws if buffers have different lengths
      return false;
    }
  }

  extractMetadata(headers: Record<string, string | string[] | undefined>): {
    event: string;
    deliveryId: string;
  } {
    const event = this.getHeader(headers, 'x-github-event');
    const deliveryId = this.getHeader(headers, 'x-github-delivery');

    if (!event || !deliveryId) {
      throw new Error('Missing required GitHub webhook headers');
    }

    return { event, deliveryId };
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string
  ): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
