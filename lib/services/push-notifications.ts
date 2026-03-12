/**
 * Push notification delivery for offline agents.
 *
 * When a task is queued (agent offline/busy/DND) and the agent has
 * a pushEndpointUrl, we fire a lightweight push notification payload.
 *
 * This is "best effort" — push delivery failures don't block task flow.
 * The push tells the agent to poll its inbox, not the full message.
 */

import { validateWebhookUrl } from '@/lib/ssrf';

const PUSH_TIMEOUT_MS = 3000;

export interface PushPayload {
  taskId: string;
  intent: string;
  callerId?: string | null;
  callerNumber?: string | null;
  reason: 'offline' | 'busy' | 'dnd';
  awayMessage?: string | null;
}

/**
 * Send a push notification to an agent's push endpoint.
 * Returns true if the push was accepted, false otherwise.
 * Never throws.
 */
export async function sendPushNotification(
  pushEndpointUrl: string,
  payload: PushPayload,
): Promise<boolean> {
  try {
    const ssrfCheck = await validateWebhookUrl(pushEndpointUrl);
    if (!ssrfCheck.ok) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);

    const response = await fetch(pushEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Molt-Event': 'task.queued',
      },
      body: JSON.stringify({
        event: 'task.queued',
        ...payload,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
