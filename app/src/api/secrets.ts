import { apiJson, jsonInit } from "./request";

// Server-side enum in src/secret-store.ts:SECRET_DEFS is currently "openai"-only.
// `raindrop` and `query` were removed in F-001 (cloud) and F-017 (local search).
// `anthropic` had no server backing (F-002) and is removed here too.
export type SecretKey = "openai";
export type SecretSource = "env" | "store" | null;

export interface SecretStatus {
  configured: boolean;
  source: SecretSource;
  env_var: string;
}

export type SecretStatuses = Record<SecretKey, SecretStatus>;

export async function getSecretStatuses(): Promise<SecretStatuses> {
  const body = await apiJson<{ keys: SecretStatuses }>("/api/secrets");
  return body.keys;
}

export async function saveSecret(key: SecretKey, value: string): Promise<SecretStatus> {
  const body = await apiJson<{ status: SecretStatus }>(`/api/secrets/${key}`, jsonInit("PUT", { value }));
  return body.status;
}

export async function deleteSecret(key: SecretKey): Promise<SecretStatus> {
  const body = await apiJson<{ status: SecretStatus }>(`/api/secrets/${key}`, jsonInit("DELETE"));
  return body.status;
}

export function purgeLegacyBrowserSecrets(): void {
  for (const key of ["rd_api_key", "rd_openai_key", "rd_raindrop_key", "rd_query_key"]) {
    try { localStorage.removeItem(key); } catch {}
  }
}
