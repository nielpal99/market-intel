import { chat } from "@trigger.dev/sdk/ai";
import { streamText } from "ai";
import { systemPrompt, model, buildMarketIntelTools, marketIntelStreamControls, compactMarketIntelMessages } from "@/lib/agent-tools";

export const marketIntel = chat.agent({
  id: "market-intel",
  tools: ({ chatId }) => buildMarketIntelTools(chatId),
  run: async ({ messages, tools, signal }) =>
    streamText({
      model,
      system: systemPrompt(),
      messages: compactMarketIntelMessages(messages),
      tools,
      abortSignal: signal,
      ...marketIntelStreamControls(),
    }),
});
