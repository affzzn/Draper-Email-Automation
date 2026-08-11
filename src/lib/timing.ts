import { toZonedTime, fromZonedTime } from "date-fns-tz";

const LONDON = "Europe/London";

// Spec §8. Compute BOTH send-window policies and store both. Client hasn't decided.
// Immediate = received + small processing delay.
// Held      = if received falls 00:00–04:00 London, hold to 05:30 that London day;
//             otherwise same as immediate.
// Europe/London handles BST automatically via the IANA tz database.
export interface SendWindows {
  immediate: Date;
  held: Date;
}

const PROCESSING_MS = 30 * 1000; // nominal pipeline time

export function computeSendWindows(receivedAt: Date): SendWindows {
  const immediate = new Date(receivedAt.getTime() + PROCESSING_MS);

  const local = toZonedTime(receivedAt, LONDON);
  const hour = local.getHours();

  let held = immediate;
  if (hour >= 0 && hour < 4) {
    // 05:30 on the same local calendar day as `local`
    const y = local.getFullYear();
    const m = local.getMonth();
    const d = local.getDate();
    // Build a London-local wall-clock time, convert back to a UTC instant.
    const localHold = new Date(y, m, d, 5, 30, 0, 0);
    held = fromZonedTime(localHold, LONDON);
  }

  return { immediate, held };
}
