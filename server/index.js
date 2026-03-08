import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { clerkMiddleware } from '@clerk/express';
import aiRoutes from './routes/ai.js';
import agentRoutes from './routes/agent.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import netsuiteRoutes from './routes/netsuite.js';
import automationRoutes from './routes/autonomousAgents.js';
import { requireClerkAuth } from './middleware/auth.js';
import { initScheduler } from './services/schedulerService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const app = express();
const PORT = process.env.PORT || 3001;

// In production client is served from the same origin — no CORS needed
if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
}

if (isProd) app.set('trust proxy', 1);

app.use(clerkMiddleware());
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: isProd, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Routes — auth callback is public (redirect from NetSuite, no Clerk session)
app.use('/api/auth', authRoutes);
app.use('/api/ai', requireClerkAuth, aiRoutes);
app.use('/api/agent', requireClerkAuth, agentRoutes);
app.use('/api/dashboard', requireClerkAuth, dashboardRoutes);
app.use('/api/netsuite', requireClerkAuth, netsuiteRoutes);
app.use('/api/automation', requireClerkAuth, automationRoutes);

// Serve React build in production
if (isProd) {
  const clientDist = join(__dirname, '../client/dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => res.sendFile(join(clientDist, 'index.html')));
  }
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  initScheduler();
});
