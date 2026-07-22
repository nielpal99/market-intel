import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { systemPrompt, model, buildMarketIntelTools, marketIntelStreamControls, compactMarketIntelMessages } from "@/lib/agent-tools";
import { triggerApiClient } from "@/lib/trigger-api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Warm first-turn handler: streams step 1 from this route while the
// agent run boots, then hands over. Paired with the browser transport's
// `headStart: "/api/chat"` option.
export const POST = chat.headStart({
  agentId: "market-intel",
  apiClient: triggerApiClient(),
  run: async ({ chat: helper }) => {
    const streamOptions = helper.toStreamTextOptions({ tools: buildMarketIntelTools(helper.session.chatId) });
    return streamText({
      ...streamOptions,
      messages: compactMarketIntelMessages(streamOptions.messages),
      model,
      system: systemPrompt(),
      ...marketIntelStreamControls(),
    });
  },
});
