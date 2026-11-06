import { useEffect, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { api } from "./connection";
import { OperationQueue, type Snapshot } from "./operation-queue";
const queues = new Map<string, OperationQueue>();
function queueFor(userId: string) {
  let queue = queues.get(userId);
  if (!queue) {
    const key = "tazweed.pending.v08." + userId;
    queue = new OperationQueue(
      {
        read: async () => {
          if (Platform.OS === "web") return null;
          const value = await SecureStore.getItemAsync(key);
          return value ? JSON.parse(value) : null;
        },
        write: async (command) => {
          if (Platform.OS !== "web")
            await SecureStore.setItemAsync(key, JSON.stringify(command));
        },
        remove: async () => {
          if (Platform.OS !== "web") await SecureStore.deleteItemAsync(key);
        },
      },
      (c) => api(c.path, c.body, "POST", c.key, userId),
      () => Crypto.randomUUID(),
    );
    queues.set(userId, queue);
  }
  return queue;
}
export function useOperation(userId?: string) {
  const [state, setState] = useState<Snapshot>({
    command: null,
    busy: false,
    ready: false,
  });
  useEffect(() => {
    if (!userId) {
      setState({ command: null, busy: false, ready: false });
      return;
    }
    const queue = queueFor(userId),
      unsubscribe = queue.subscribe(setState);
    void queue.restore().catch(() => {});
    return unsubscribe;
  }, [userId]);
  return {
    ...state,
    execute: (path?: string, body?: unknown) => {
      if (!userId) return Promise.reject(Error("سجل الدخول"));
      return queueFor(userId).execute(path, body);
    },
  };
}

export async function eraseStoredOperations(userId: string) {
  const q = queues.get(userId);
  if (q) await q.erase();
  if (Platform.OS !== "web")
    await SecureStore.deleteItemAsync("tazweed.pending.v08." + userId);
  queues.delete(userId);
}
