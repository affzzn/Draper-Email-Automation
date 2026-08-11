// Central env access with a hard safety tripwire.
// Spec §0: nothing sends in v1. RUN_MODE must be "shadow" or the app refuses to boot.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

// The tripwire. Imported at the top of every entry point (routes, scripts).
export function assertShadowMode(): void {
  const mode = optional("RUN_MODE", "shadow");
  if (mode !== "shadow") {
    throw new Error(
      `RUN_MODE is "${mode}" but v1 only supports "shadow". ` +
        `Sending is not implemented and Mail.Send is not granted. Refusing to start.`
    );
  }
}

export const env = {
  get tenantId() {
    return required("TENANT_ID");
  },
  get clientId() {
    return required("CLIENT_ID");
  },
  get clientSecret() {
    return required("CLIENT_SECRET");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get publicUrl() {
    return optional("PUBLIC_URL", "http://localhost:3000").replace(/\/$/, "");
  },
  get graphClientState() {
    return optional("GRAPH_CLIENT_STATE", "draper-shadow-client-state");
  },
  get cronSecret() {
    return optional("CRON_SECRET", "");
  },
  get anthropicApiKey() {
    return optional("ANTHROPIC_API_KEY", "");
  },
  get anthropicModel() {
    return optional("ANTHROPIC_MODEL", "claude-sonnet-5");
  },
};
