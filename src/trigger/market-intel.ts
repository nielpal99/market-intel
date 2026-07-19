import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { SYSTEM_PROMPT, MODEL_ID, buildMarketIntelTools } from "@/lib/agent-tools";

export const marketIntel = chat.agent({
  id: "market-intel",
  tools: ({ chatId }) => buildMarketIntelTools(chatId),
  run: async ({ messages, tools, signal }) =>
    streamText({
      model: anthropic(MODEL_ID),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      abortSignal: signal,
      stopWhen: stepCountIs(15),
    }),
});
