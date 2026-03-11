export class GitLabWebhook {
  constructor(private readonly token?: string) {}

  validate(
    headers: Record<string, string | string[] | undefined>,
    _rawBody: string | Buffer
  ): { valid: boolean; error?: string } {
    const event = this.getHeader(headers, 'x-gitlab-event');

    if (!event) {
      return { valid: false, error: 'Missing X-Gitlab-Event header' };
    }

    // Verify token if configured
    if (this.token) {
      const receivedToken = this.getHeader(headers, 'x-gitlab-token');

      if (!receivedToken) {
        return { valid: false, error: 'Missing X-Gitlab-Token header' };
      }

      if (receivedToken !== this.token) {
        return { valid: false, error: 'Invalid webhook token' };
      }
    }

    return { valid: true };
  }

  extractMetadata(headers: Record<string, string | string[] | undefined>): { event: string } {
    const event = this.getHeader(headers, 'x-gitlab-event');

    if (!event) {
      throw new Error('Missing required GitLab webhook headers');
    }

    return { event };
  }

  private getHeader(
    headers: Record<string, string | string[] | undefined>,
    name: string
  ): string | undefined {
    const value = headers[name] || headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
  }
}
