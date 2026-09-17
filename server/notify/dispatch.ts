import type { Channel } from "../db/schema";
import { sendToChannel, type NotificationPayload, type NotifySecrets } from "./index";

export interface NotifyJob { channelId: string; payload: NotificationPayload }

/**
 * Deliver a notification. With a NOTIFY_QUEUE binding (Workers Paid) the job is queued and retried
 * with backoff by the queue consumer in workers/app.ts; without one it is sent inline.
 */
export async function dispatchNotification(env: Env, channel: Channel, payload: NotificationPayload): Promise<void> {
  const queue = (env as unknown as { NOTIFY_QUEUE?: Queue<NotifyJob> }).NOTIFY_QUEUE;
  if (queue) {
    await queue.send({ channelId: channel.id, payload });
    return;
  }
  await sendToChannel(channel, payload, env as unknown as NotifySecrets);
}
