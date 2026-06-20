import express from 'express';
import cors    from 'cors';
import dotenv  from 'dotenv';
import { testRoutes }   from './routes/tests.js';
import { reportRoutes } from './routes/reports.js';
import { initDb }       from './db.js';
dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use('/screenshots', express.static('screenshots'));
app.use('/api/tests',   testRoutes);
app.use('/api/reports', reportRoutes);
app.get('/api/health', (_, res) => res.json({
  status: 'ok',
  platform: 'Authentication Feature Testing Platform',
}));
const PORT = process.env.PORT || 3001;
await initDb();
app.listen(PORT, () =>
  console.log(`[server] Authentication Feature Testing Platform running on port ${PORT}`)
);