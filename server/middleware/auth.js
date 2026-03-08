import { getAuth } from '@clerk/express';

export function requireClerkAuth(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  req.userId = userId;
  next();
}
