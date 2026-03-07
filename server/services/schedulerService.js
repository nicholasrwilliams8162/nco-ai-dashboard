import cron from 'node-cron';
import { executeAgent } from './autonomousAgentService.js';
import db from '../db/database.js';

// Map of agentId -> cron task
const jobs = new Map();

export function scheduleAgent(agent) {
  unscheduleAgent(agent.id);

  if (!agent.enabled || agent.paused) return;

  if (!cron.validate(agent.schedule)) {
    console.warn(`[Scheduler] Invalid cron expression for agent "${agent.name}": ${agent.schedule}`);
    return;
  }

  const task = cron.schedule(agent.schedule, async () => {
    console.log(`[Scheduler] Running agent "${agent.name}" (id=${agent.id})`);
    try {
      await executeAgent(agent.id);
    } catch (err) {
      console.error(`[Scheduler] Agent "${agent.name}" failed:`, err.message);
    }
  });

  jobs.set(agent.id, task);
  console.log(`[Scheduler] Scheduled "${agent.name}" @ ${agent.schedule}`);
}

export function unscheduleAgent(agentId) {
  const task = jobs.get(agentId);
  if (task) {
    task.stop();
    jobs.delete(agentId);
  }
}

export function initScheduler() {
  const agents = db.prepare(
    'SELECT * FROM autonomous_agents WHERE enabled = 1 AND paused = 0'
  ).all();

  for (const agent of agents) {
    scheduleAgent(agent);
  }

  console.log(`[Scheduler] Initialized with ${agents.length} active agent(s)`);
}
