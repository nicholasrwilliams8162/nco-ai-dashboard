import { create } from 'zustand';
import api from '../api/client';

export const useDashboardStore = create((set, get) => ({
  widgets: [],
  dashboardInfo: { name: 'My Dashboard' },
  isLoading: false,
  isRefreshing: false,
  refreshStatus: null, // { refreshed, failed, total }
  lastRefreshed: null,
  error: null,
  authStatus: { connected: false, accountId: null },
  groqKeySet: false,

  checkAuth: async () => {
    try {
      const [nsRes, settingsRes] = await Promise.all([
        api.get('/auth/netsuite/status'),
        api.get('/auth/settings'),
      ]);
      set({ authStatus: nsRes.data, groqKeySet: settingsRes.data.groqKeySet });
    } catch {
      set({ authStatus: { connected: false, accountId: null } });
    }
  },

  loadWidgets: async () => {
    set({ isLoading: true, error: null });
    try {
      const [widgetsRes, infoRes] = await Promise.all([
        api.get('/dashboard/widgets'),
        api.get('/dashboard/info'),
      ]);
      set({ widgets: widgetsRes.data, dashboardInfo: infoRes.data, isLoading: false });
      // Background refresh after showing cached data
      get().refreshAll();
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  refreshAll: async () => {
    set({ isRefreshing: true });
    try {
      const statusRes = await api.post('/dashboard/refresh-all');
      const widgetsRes = await api.get('/dashboard/widgets');
      set({
        widgets: widgetsRes.data,
        lastRefreshed: new Date().toISOString(),
        refreshStatus: statusRes.data,
        isRefreshing: false,
      });
    } catch (err) {
      set({ isRefreshing: false });
    }
  },

  refreshWidget: async (widgetId) => {
    try {
      const res = await api.post(`/dashboard/widgets/${widgetId}/refresh`);
      set(state => ({
        widgets: state.widgets.map(w =>
          w.id === widgetId
            ? { ...w, cached_data: res.data.data, cached_at: res.data.refreshedAt }
            : w
        ),
      }));
    } catch (err) {
      console.error('Widget refresh failed:', err.message);
    }
  },

  pinWidget: async (queryResult) => {
    const payload = {
      title: queryResult.visualization.title,
      visualization_type: queryResult.visualization.type,
      suiteql_query: queryResult.query,
      visualization_config: {
        xAxis: queryResult.visualization.xAxis,
        yAxis: queryResult.visualization.yAxis,
        valueColumn: queryResult.visualization.valueColumn,
        labelColumn: queryResult.visualization.labelColumn,
        description: queryResult.visualization.description,
      },
      original_question: queryResult.originalQuestion,
      interpretation: queryResult.interpretation,
      data: queryResult.data,
      suggestedRefreshInterval: queryResult.suggestedRefreshInterval,
    };

    await api.post('/dashboard/widgets', payload);
    await get().loadWidgets();
  },

  removeWidget: async (widgetId) => {
    await api.delete(`/dashboard/widgets/${widgetId}`);
    set(state => ({ widgets: state.widgets.filter(w => w.id !== widgetId) }));
  },

  updateLayout: async (layouts) => {
    try {
      await api.put('/dashboard/layout', { layouts });
    } catch (err) {
      console.error('Layout save failed:', err.message);
    }
  },

  renameWidget: async (widgetId, title) => {
    await api.patch(`/dashboard/widgets/${widgetId}`, { title });
    set(state => ({
      widgets: state.widgets.map(w => w.id === widgetId ? { ...w, title } : w),
    }));
  },

  changeVisualizationType: async (widgetId, visualization_type) => {
    await api.patch(`/dashboard/widgets/${widgetId}`, { visualization_type });
    set(state => ({
      widgets: state.widgets.map(w => w.id === widgetId ? { ...w, visualization_type } : w),
    }));
  },

  resizeWidget: async (widgetId, gridW) => {
    set(state => ({
      widgets: state.widgets.map(w => w.id === widgetId ? { ...w, grid_w: gridW } : w),
    }));
    const { widgets } = get();
    const layouts = widgets.map(w => ({ i: w.id, x: w.grid_x, y: w.grid_y, w: w.grid_w, h: w.grid_h }));
    await api.put('/dashboard/layout', { layouts });
  },

  updateWidgetConfig: async (widgetId, patch) => {
    await api.patch(`/dashboard/widgets/${widgetId}`, patch);
    set(state => ({
      widgets: state.widgets.map(w =>
        w.id === widgetId
          ? {
              ...w,
              ...(patch.visualization_type && { visualization_type: patch.visualization_type }),
              ...(patch.visualization_config && { visualization_config: { ...w.visualization_config, ...patch.visualization_config } }),
              ...(patch.title && { title: patch.title }),
              ...(patch.suiteql_query && { suiteql_query: patch.suiteql_query }),
              ...(patch.original_question && { original_question: patch.original_question }),
              ...(patch.interpretation && { interpretation: patch.interpretation }),
              ...(patch.cached_data && { cached_data: patch.cached_data, cached_at: new Date().toISOString() }),
            }
          : w
      ),
    }));
  },

  renameDashboard: async (name) => {
    await api.patch('/dashboard/info', { name });
    set(state => ({ dashboardInfo: { ...state.dashboardInfo, name } }));
  },
}));
