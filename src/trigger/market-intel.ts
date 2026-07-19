import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs } from "ai";
import { SYSTEM_PROMPT, model, buildMarketIntelTools } from "@/lib/agent-tools";

export const marketIntel = chat.agent({
  id: "market-intel",
  tools: ({ chatId }) => buildMarketIntelTools(chatId),
  run: async ({ messages, tools, signal }) =>
    streamText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      abortSignal: signal,
      stopWhen: stepCountIs(15),
    }),
});
