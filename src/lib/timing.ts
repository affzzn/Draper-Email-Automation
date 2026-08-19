import { toZonedTime, fromZonedTime } from "date-fns-tz";

const LONDON = "Europe/London";

// Spec §8. Compute BOTH send-window policies and store both. Client hasn't decided.
// Immediate = received + small processing delay.
// Held      = if received falls 00:00–04:00 London, hold to 05:30 that London day;
//             otherwise same as immediate.
// Europe/London handles BST automatically via the IANA tz database.
export interface SendWindows {
  immediate: Date; // received + 4 minutes (the standard rule)
  held: Date; // final send time: overnight enquiries held to 05:30, else same as immediate
}

const SEND_DELAY_MS = 4 * 60 * 1000; // send 4 minutes after the enquiry is received
const OVERNIGHT_CUTOFF_MIN = 5 * 60 + 30; // 05:30 London

export function computeSendWindows(receivedAt: Date): SendWindows {
  const immediate = new Date(receivedAt.getTime() + SEND_DELAY_MS);

  const local = toZonedTime(receivedAt, LONDON);
  const minutesSinceMidnight = local.getHours() * 60 + local.getMinutes();

  let held = immediate;
  // Anything received between 00:00 and 05:30 local goes out at 05:30 that day.
  if (minutesSinceMidnight < OVERNIGHT_CUTOFF_MIN) {
    const pad = (n: number) => String(n).padStart(2, "0");
    // "05:30 London on the enquiry's local date" as an unambiguous wall-clock string.
    const holdWallClock = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(
      local.getDate()
    )}T05:30:00`;
    held = fromZonedTime(holdWallClock, LONDON);
  }

  return { immediate, held };
}
