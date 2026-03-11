import express, { type Express, type Request, type Response } from 'express';
import type { Server } from 'http';
import type { ServerConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class WebhookServer {
  private app: Express;
  private server: Server | undefined;
  private activeRequests = 0;
  private shuttingDown = false;

  constructor(private readonly config: ServerConfig) {
    this.app = express();

    // Support both JSON and form-encoded webhooks
    this.app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as Request & { rawBody?: Buffer }).rawBody = buf;
        },
      })
    );

    this.app.use(
      express.urlencoded({
        extended: true,
        verify: (req, _res, buf) => {
          (req as Request & { rawBody?: Buffer }).rawBody = buf;
        },
      })
    );

    this.app.use((_req, res, next) => {
      if (this.shuttingDown) {
        res.status(503).json({ error: 'Server is shutting down' });
        return;
      }
      this.activeRequests++;
      res.on('finish', () => {
        this.activeRequests--;
      });
      next();
    });

    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });
  }

  registerWebhook(provider: string, handler: (req: Request, res: Response) => Promise<void>): void {
    const basePath = this.config.basePath || '';
    const path = `${basePath}/webhook/${provider}`;

    this.app.post(path, (req, res) => {
      handler(req, res).catch((error) => {
        logger.error(`Error handling webhook for ${provider}`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' });
        }
      });
    });

    logger.info(`Registered webhook endpoint: ${path}`);
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          logger.info(`Webhook server listening on ${this.config.host}:${this.config.port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          logger.error('Server error', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    this.shuttingDown = true;
    logger.info('Stopping webhook server...');

    const timeout = 30000;
    const startTime = Date.now();

    while (this.activeRequests > 0 && Date.now() - startTime < timeout) {
      logger.debug(`Waiting for ${this.activeRequests} active requests...`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.activeRequests > 0) {
      logger.warn(`Forcing shutdown with ${this.activeRequests} active requests`);
    }

    return new Promise((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          logger.error('Error closing server', error);
          reject(error);
        } else {
          logger.info('Webhook server stopped');
          this.server = undefined;
          this.shuttingDown = false;
          resolve();
        }
      });
    });
  }

  get isRunning(): boolean {
    return this.server !== undefined;
  }
}
