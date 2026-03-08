import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

// Attach Clerk session token to every request
api.interceptors.request.use(async (config) => {
  try {
    const token = await window.Clerk?.session?.getToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {}
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    const message = err.response?.data?.error || err.message || 'Unknown error';
    return Promise.reject(new Error(message));
  }
);

export default api;
