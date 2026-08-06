import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { requestLogger } from './infrastructure/http/middlewares/requestLogger';
import { errorHandler } from './infrastructure/http/middlewares/errorHandler';
import { authRoutes } from './infrastructure/http/routes/auth.routes';
import { aircraftRoutes } from './infrastructure/http/routes/aircraft.routes';
import { complianceRoutes } from './infrastructure/http/routes/compliance.routes';
import { componentRoutes } from './infrastructure/http/routes/component.routes';
import { componentTrackingRoutes } from './infrastructure/http/routes/componentTracking.routes';
import { taskRoutes } from './infrastructure/http/routes/tasks.routes';
import { workOrderRoutes } from './infrastructure/http/routes/workOrders.routes';
import { componentHistoryRouter, aircraftHistoryRouter, auditRouter } from './infrastructure/http/routes/componentHistory.routes';
import { templateLibraryRouter } from './infrastructure/http/controllers/TemplateLibraryController';
import { workOrderFlowRouter } from './infrastructure/http/routes/workOrderFlowRoutes';
import { workRequestRoutes } from './infrastructure/http/routes/workRequests.routes';
import { grisselleMroRoutes } from './infrastructure/http/routes/grisselleMro.routes';

export function createApp(): Application {
  const app = express();

  app.use(helmet());
  app.use(cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, Postman) or any localhost port in dev
      if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
      if (origin === env.CORS_ORIGIN) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/', (_req: Request, res: Response) => {
    if (env.NODE_ENV === 'development') {
      res.redirect(env.CORS_ORIGIN);
      return;
    }

    res.status(200).json({
      status: 'ok',
      message: 'Griselle API is running',
      frontendUrl: env.CORS_ORIGIN,
      healthUrl: '/health',
      apiBaseUrl: '/api/v1',
    });
  });

  const API = '/api/v1';
  app.use(`${API}/auth`,             authRoutes);
  app.use(`${API}/aircraft`,         aircraftRoutes);
  app.use(`${API}/aircraft`,         aircraftHistoryRouter);
  app.use(`${API}/compliances`,      complianceRoutes);
  app.use(`${API}/components`,       componentRoutes);
  app.use(`${API}/components`,       componentTrackingRoutes);
  app.use(`${API}/components`,       componentHistoryRouter);
  app.use(`${API}/tasks`,            taskRoutes);
  app.use(`${API}/work-orders`,      workOrderRoutes);
  app.use(`${API}/work-orders`,      workOrderFlowRouter);
  app.use(`${API}/audit-logs`,       auditRouter);
  app.use(`${API}/library`,          templateLibraryRouter);
  app.use(`${API}/work-requests`,    workRequestRoutes);

  // Compatibility routes for Grisselle MRO integration without version prefix.
  app.use('/api',                    grisselleMroRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ status: 'error', code: 'NOT_FOUND', message: 'Route not found' });
  });

  app.use(errorHandler);

  return app;
}
