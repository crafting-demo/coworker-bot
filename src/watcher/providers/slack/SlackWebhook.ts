import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Slack webhook handler for verifying and processing Slack events.
 *
 * Slack uses HMAC SHA-256 signature verification similar to GitHub/Linear,
 * but also includes a URL verification challenge on initial setup.
 */
export class SlackWebhook {
  constructor(private readonly signingSecret?: string) {}

  /**
   * Validate a Slack webhook request.
   * Handles both URL verification challenges and event callbacks.
   */
  validate(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody: string | Buffer
  ): { valid: boolean; error?: string; challenge?: string } {
    const bodyObj = typeof body === 'object' && body !== null ? (body as any) : {};

    // Handle URL verification challenge (sent when first configuring webhook)
    if (bodyObj.type === 'url_verification') {
      if (!bodyObj.challenge) {
        return { valid: false, error: 'Missing challenge in url_verification' };
      }
      return { valid: true, challenge: bodyObj.challenge };
    }

    // Verify signature if signing secret is configured
    if (this.signingSecret) {
      const timestamp = this.getHeader(headers, 'x-slack-request-timestamp');
      const signature = this.getHeader(headers, 'x-slack-signature');

      if (!timestamp) {
        return { valid: false, error: 'Missing X-Slack-Request-Timestamp header' };
      }

      if (!signature) {
        return { valid: false, error: 'Missing X-Slack-Signature header' };
      }

      // Prevent replay attacks - reject requests older than 5 minutes
      const currentTime = Math.floor(Date.now() / 1000);
      const requestTime = parseInt(timestamp, 10);
      if (Math.abs(currentTime - requestTime) > 300) {
        return { valid: false, error: 'Request timestamp too old' };
      }

      const isValid = this.verifySignature(signature, timestamp, rawBody);
      if (!isValid) {
        return { valid: false, error: 'Invalid webhook signature' };
      }
    }

    return { valid: true };
  }

  /**
   * Verify Slack signature using HMAC SHA-256.
   * Format: v0=<hash of basestring>
   * Basestring: v0:<timestamp>:<request_body>
   */
  private verifySignature(signature: string, timestamp: string, body: string | Buffer): boolean {
    if (!this.signingSecret) {
      return false;
    }

    // Slack signature format: v0=<hex>
    if (!signature.startsWith('v0=')) {
      return false;
    }

    const expectedSignature = signature.slice(3); // Remove 'v0=' prefix

    // Build the basestring: v0:<timestamp>:<body>
    const bodyString = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    const basestring = `v0:${timestamp}:${bodyString}`;

    // Compute HMAC SHA-256
    const hmac = createHmac('sha256', this.signingSecret);
    hmac.update(basestring);
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

  /**
   * Extract Slack event metadata from headers and body.
   */
  extractMetadata(
    headers: Record<string, string | string[] | undefined>,
    body: unknown
  ): { eventType: string; eventId: string; retryNum?: number } {
    const bodyObj = typeof body === 'object' && body !== null ? (body as any) : {};

    const eventType = bodyObj.event?.type || bodyObj.type || 'unknown';
    const eventId = this.getHeader(headers, 'x-slack-request-timestamp') || Date.now().toString();
    const retryNumHeader = this.getHeader(headers, 'x-slack-retry-num');

    const result: { eventType: string; eventId: string; retryNum?: number } = {
      eventType,
      eventId,
    };

    if (retryNumHeader) {
      result.retryNum = parseInt(retryNumHeader, 10);
    }

    return result;
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string
  ): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
