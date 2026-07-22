import type { ApiClientConfiguration } from "@trigger.dev/core/v3";

export function triggerApiClient(): ApiClientConfiguration {
  const accessToken = process.env.TRIGGER_SECRET_KEY ?? process.env.TRIGGER_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("Missing TRIGGER_SECRET_KEY");
  }

  return {
    baseURL: process.env.TRIGGER_API_URL ?? "https://api.trigger.dev",
    accessToken,
    previewBranch: "",
  };
}
