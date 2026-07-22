import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { systemPrompt, model, buildMarketIntelTools, marketIntelStreamControls, compactMarketIntelMessages } from "@/lib/agent-tools";
import { triggerApiClient } from "@/lib/trigger-api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function schemaOnlyTools(chatId: string) {
  const tools = buildMarketIntelTools(chatId);
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const { execute, ...schemaOnlyTool } = tool as typeof tool & { execute?: unknown };
      return [name, schemaOnlyTool];
    })
  ) as typeof tools;
}

// Warm first-turn handler: streams step 1 from this route while the
// agent run boots, then hands over. Paired with the browser transport's
// `headStart: "/api/chat"` option.
export const POST = chat.headStart({
  agentId: "market-intel",
  apiClient: triggerApiClient(),
  run: async ({ chat: helper }) => {
    const streamOptions = helper.toStreamTextOptions({ tools: schemaOnlyTools(helper.session.chatId) });
    return streamText({
      ...streamOptions,
      messages: compactMarketIntelMessages(streamOptions.messages),
      model,
      system: systemPrompt(),
      ...marketIntelStreamControls(),
    });
  },
});
