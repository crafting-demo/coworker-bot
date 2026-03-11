import type { Request, Response } from 'express';
import type { IProvider, EventHandler } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class WebhookHandler {
  constructor(
    private readonly provider: IProvider,
    private readonly eventHandler: EventHandler
  ) {}

  async handle(req: Request, res: Response): Promise<void> {
    try {
      if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }

      // GitHub can send webhooks as either:
      // - application/json: body is the JSON object directly
      // - application/x-www-form-urlencoded: body.payload is a JSON string
      let body = req.body;
      if (body && typeof body.payload === 'string') {
        try {
          body = JSON.parse(body.payload);
        } catch (error) {
          logger.error('Failed to parse form-encoded payload', error);
          res.status(400).json({ error: 'Invalid payload format' });
          return;
        }
      }

      // Handle Slack URL verification challenge
      if (body && typeof body === 'object' && 'type' in body && body.type === 'url_verification') {
        const challenge = (body as any).challenge;
        if (challenge) {
          logger.debug('Responding to Slack URL verification challenge');
          res.status(200).json({ challenge });
          return;
        }
      }

      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const isValid = await this.provider.validateWebhook(req.headers, body, rawBody);

      if (!isValid) {
        logger.warn('Webhook validation failed', { provider: this.provider.metadata.name });
        res.status(401).json({ error: 'Invalid webhook' });
        return;
      }

      res.status(202).json({ status: 'accepted' });

      setImmediate(() => {
        this.processWebhook(req.headers, body).catch((error) => {
          logger.error('Failed to process webhook', error);
        });
      });
    } catch (error) {
      logger.error('Webhook handler error', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  private async processWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown
  ): Promise<void> {
    await this.provider.handleWebhook(headers, body, this.eventHandler);
  }
}
