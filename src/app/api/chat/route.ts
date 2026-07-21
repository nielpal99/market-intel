import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { systemPrompt, model, buildMarketIntelTools, marketIntelStreamControls } from "@/lib/agent-tools";

// Warm first-turn handler: streams step 1 from this route while the
// agent run boots, then hands over. Paired with the browser transport's
// `headStart: "/api/chat"` option.
export const POST = chat.headStart({
  agentId: "market-intel",
  run: async ({ chat: helper }) =>
    streamText({
      ...helper.toStreamTextOptions({ tools: buildMarketIntelTools(helper.session.chatId) }),
      model,
      system: systemPrompt(),
      ...marketIntelStreamControls(),
    }),
});
