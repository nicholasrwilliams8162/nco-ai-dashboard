import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import db from '../db/database.js';
import { refreshWidgetData } from '../services/aiService.js';

const router = express.Router();
const limit = pLimit(5); // max 5 concurrent NetSuite calls

function getUserDashboardId(userId) {
  const existing = db.prepare('SELECT id FROM dashboards WHERE user_id = ?').get(userId);
  if (existing) return existing.id;
  const result = db.prepare(
    "INSERT INTO dashboards (name, user_id) VALUES ('My Dashboard', ?)"
  ).run(userId);
  return result.lastInsertRowid;
}

// GET /api/dashboard/widgets
router.get('/widgets', (req, res) => {
  const dashboardId = getUserDashboardId(req.userId);
  const widgets = db.prepare(`
    SELECT * FROM widgets WHERE dashboard_id = ? ORDER BY grid_y, grid_x
  `).all(dashboardId);

  const parsed = widgets.map(w => ({
    ...w,
    visualization_config: JSON.parse(w.visualization_config),
    cached_data: w.cached_data ? JSON.parse(w.cached_data) : null,
  }));

  res.json(parsed);
});

// POST /api/dashboard/widgets — pin a widget
router.post('/widgets', (req, res) => {
  const {
    title, visualization_type, suiteql_query, visualization_config,
    original_question, interpretation, data, suggestedRefreshInterval,
  } = req.body;

  if (!title || !visualization_type || !suiteql_query) {
    return res.status(400).json({ error: 'title, visualization_type, and suiteql_query are required' });
  }

  const dashboardId = getUserDashboardId(req.userId);
  const id = uuidv4();
  const now = new Date().toISOString();

  const lastWidget = db.prepare(`
    SELECT MAX(grid_y + grid_h) AS next_y FROM widgets WHERE dashboard_id = ?
  `).get(dashboardId);
  const nextY = lastWidget?.next_y || 0;

  db.prepare(`
    INSERT INTO widgets (
      id, dashboard_id, title, visualization_type, suiteql_query,
      visualization_config, original_question, interpretation,
      cached_data, cached_at, refresh_interval, grid_x, grid_y, grid_w, grid_h
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 12, 4)
  `).run(
    id, dashboardId, title, visualization_type, suiteql_query,
    JSON.stringify(visualization_config || {}),
    original_question || null,
    interpretation || null,
    data ? JSON.stringify(data) : null,
    data ? now : null,
    suggestedRefreshInterval || 300,
    nextY
  );

  res.json({ id, success: true });
});

// DELETE /api/dashboard/widgets/:id
router.delete('/widgets/:id', (req, res) => {
  const dashboardId = getUserDashboardId(req.userId);
  const info = db.prepare('DELETE FROM widgets WHERE id = ? AND dashboard_id = ?').run(req.params.id, dashboardId);
  if (info.changes === 0) return res.status(404).json({ error: 'Widget not found' });
  res.json({ success: true });
});

// PUT /api/dashboard/layout — save layout after drag/resize
router.put('/layout', (req, res) => {
  const { layouts } = req.body;
  if (!Array.isArray(layouts)) return res.status(400).json({ error: 'layouts must be an array' });

  const update = db.prepare(`
    UPDATE widgets SET grid_x = ?, grid_y = ?, grid_w = ?, grid_h = ? WHERE id = ?
  `);
  const updateMany = db.transaction((items) => {
    for (const item of items) {
      update.run(item.x, item.y, item.w, item.h, item.i);
    }
  });

  updateMany(layouts);
  res.json({ success: true });
});

// PATCH /api/dashboard/widgets/:id — update any widget fields
router.patch('/widgets/:id', (req, res) => {
  const { title, visualization_type, visualization_config, suiteql_query, original_question, interpretation, cached_data } = req.body;
  const now = new Date().toISOString();
  if (title !== undefined)
    db.prepare('UPDATE widgets SET title = ? WHERE id = ?').run(title, req.params.id);
  if (visualization_type !== undefined)
    db.prepare('UPDATE widgets SET visualization_type = ? WHERE id = ?').run(visualization_type, req.params.id);
  if (visualization_config !== undefined)
    db.prepare('UPDATE widgets SET visualization_config = ? WHERE id = ?').run(JSON.stringify(visualization_config), req.params.id);
  if (suiteql_query !== undefined)
    db.prepare('UPDATE widgets SET suiteql_query = ? WHERE id = ?').run(suiteql_query, req.params.id);
  if (original_question !== undefined)
    db.prepare('UPDATE widgets SET original_question = ? WHERE id = ?').run(original_question, req.params.id);
  if (interpretation !== undefined)
    db.prepare('UPDATE widgets SET interpretation = ? WHERE id = ?').run(interpretation, req.params.id);
  if (cached_data !== undefined)
    db.prepare('UPDATE widgets SET cached_data = ?, cached_at = ? WHERE id = ?').run(JSON.stringify(cached_data), now, req.params.id);
  res.json({ success: true });
});

// POST /api/dashboard/widgets/:id/refresh — refresh single widget
router.post('/widgets/:id/refresh', async (req, res) => {
  const widget = db.prepare('SELECT * FROM widgets WHERE id = ?').get(req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });

  try {
    const result = await refreshWidgetData(widget.suiteql_query, req.userId);
    db.prepare(`
      UPDATE widgets SET cached_data = ?, cached_at = ? WHERE id = ?
    `).run(JSON.stringify(result.data), result.refreshedAt, req.params.id);
    res.json({ data: result.data, refreshedAt: result.refreshedAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/dashboard/refresh-all — refresh all widgets
router.post('/refresh-all', async (req, res) => {
  const dashboardId = getUserDashboardId(req.userId);
  const widgets = db.prepare('SELECT id, suiteql_query FROM widgets WHERE dashboard_id = ?').all(dashboardId);

  const results = await Promise.allSettled(
    widgets.map(w =>
      limit(async () => {
        const result = await refreshWidgetData(w.suiteql_query, req.userId);
        db.prepare(`
          UPDATE widgets SET cached_data = ?, cached_at = ? WHERE id = ?
        `).run(JSON.stringify(result.data), result.refreshedAt, w.id);
        return { id: w.id };
      })
    )
  );

  res.json({
    total: widgets.length,
    refreshed: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
    errors: results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message),
  });
});

// GET /api/dashboard/info
router.get('/info', (req, res) => {
  const dashboardId = getUserDashboardId(req.userId);
  const dashboard = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(dashboardId);
  const count = db.prepare('SELECT COUNT(*) as count FROM widgets WHERE dashboard_id = ?').get(dashboardId);
  res.json({ ...dashboard, widgetCount: count.count });
});

// PATCH /api/dashboard/info — rename dashboard
router.patch('/info', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const dashboardId = getUserDashboardId(req.userId);
  db.prepare('UPDATE dashboards SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, dashboardId);
  res.json({ success: true });
});

export default router;
