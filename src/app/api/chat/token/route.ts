import { chat } from "@trigger.dev/sdk/ai";
import { apiClientManager } from "@trigger.dev/core/v3";
import { triggerApiClient } from "@/lib/trigger-api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await apiClientManager.runWithConfig(triggerApiClient(), () => chat.createAccessToken("market-intel"));
  return Response.json({ token });
}
