import { createHmac, timingSafeEqual } from 'crypto';

export class JiraWebhook {
  constructor(private readonly secret?: string) {}

  validate(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string | Buffer
  ): { valid: boolean; error?: string } {
    // If no secret configured, accept all webhooks
    if (!this.secret) {
      return { valid: true };
    }

    // Jira Cloud sends HMAC signature in X-Hub-Signature: method=signature
    const signatureHeader = this.getHeader(headers, 'x-hub-signature');
    if (!signatureHeader) {
      return { valid: false, error: 'Missing X-Hub-Signature header' };
    }

    const eqIdx = signatureHeader.indexOf('=');
    if (eqIdx === -1) {
      return { valid: false, error: 'Malformed X-Hub-Signature header' };
    }

    const method = signatureHeader.slice(0, eqIdx);
    const signature = signatureHeader.slice(eqIdx + 1);

    const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const expected = createHmac(method, this.secret).update(body).digest('hex');

    try {
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: 'X-Hub-Signature mismatch' };
      }
    } catch {
      return { valid: false, error: 'X-Hub-Signature mismatch' };
    }

    return { valid: true };
  }

  extractMetadata(headers: Record<string, string | string[] | undefined>): { deliveryId: string } {
    // Jira does not send a standard unique delivery ID header; derive one from timestamp
    const timestamp =
      this.getHeader(headers, 'x-atlassian-event-source-info') || Date.now().toString();
    return { deliveryId: timestamp };
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string
  ): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
