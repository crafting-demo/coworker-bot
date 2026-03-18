export class JiraWebhook {
  constructor(private readonly secret?: string) {}

  validate(
    headers: Record<string, string | string[] | undefined>,
    _rawBody: string | Buffer
  ): { valid: boolean; error?: string } {
    // If no secret configured, accept all webhooks
    if (!this.secret) {
      return { valid: true };
    }

    // Check shared secret from X-Jira-Webhook-Token header
    const token = this.getHeader(headers, 'x-jira-webhook-token');
    if (!token) {
      return { valid: false, error: 'Missing X-Jira-Webhook-Token header' };
    }

    // Simple string comparison for shared secret
    // Jira does not provide a standard HMAC signing mechanism for system webhooks
    if (token !== this.secret) {
      return { valid: false, error: 'Invalid webhook token' };
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
