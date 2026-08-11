import "./loadEnv";
import { assertShadowMode } from "../src/lib/env";
import { getMailboxes } from "../src/lib/mailboxes";
import { getInboxFolder } from "../src/lib/graph";

// Read-only connectivity check. Authenticates app-only and reads inbox folder
// metadata for each mailbox. Sends nothing, reads no message bodies. Proves the
// credentials work and Mail.Read is granted on all three inboxes before ingest.
async function main() {
  assertShadowMode();
  console.log("Verifying Graph access (read-only)…\n");

  let ok = 0;
  for (const mb of getMailboxes()) {
    try {
      const f = await getInboxFolder(mb.address);
      console.log(
        `✓ ${mb.role.padEnd(9)} ${mb.address} — inbox "${f.displayName}", ${f.totalItemCount} messages (${f.unreadItemCount} unread)`
      );
      ok++;
    } catch (e: unknown) {
      const err = e as { statusCode?: number; code?: string; message?: string };
      console.log(`✗ ${mb.role.padEnd(9)} ${mb.address} — FAILED`);
      console.log(`    ${err.code ?? ""} ${err.statusCode ?? ""} ${err.message ?? String(e)}`);
    }
  }

  console.log(`\n${ok}/${getMailboxes().length} mailboxes reachable.`);
  if (ok === 0) {
    console.log(
      "\nIf auth failed: CLIENT_SECRET must be the secret VALUE (a ~40-char string),\n" +
        "not the Secret ID (a GUID). Also confirm admin consent was granted for Mail.Read."
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
