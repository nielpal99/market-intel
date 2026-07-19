import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { SYSTEM_PROMPT, MODEL_ID, buildMarketIntelTools } from "@/lib/agent-tools";

// Warm first-turn handler: streams step 1 from this route while the
// agent run boots, then hands over. Paired with the browser transport's
// `headStart: "/api/chat"` option.
export const POST = chat.headStart({
  agentId: "market-intel",
  run: async ({ chat: helper }) =>
    streamText({
      ...helper.toStreamTextOptions({ tools: buildMarketIntelTools(helper.session.chatId) }),
      model: anthropic(MODEL_ID),
      system: SYSTEM_PROMPT,
    }),
});
