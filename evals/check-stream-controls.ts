import { compactMarketIntelMessages, marketIntelStreamControls } from "../src/lib/agent-tools";

const RENDER_TOOLS = [
  "render_candlestick",
  "render_spread_heatmap",
  "render_volatility_bands",
  "render_correlation_network",
  "render_verdict_card",
];

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const controls = marketIntelStreamControls();
  const firstStep = controls.prepareStep({ steps: [] });
  assert(firstStep === undefined, "First step should leave all tools available.");

  const afterQuery = controls.prepareStep({ steps: [{ toolCalls: [{ toolName: "query_correlations" }] }] });
  assert(afterQuery?.toolChoice === "required", "A post-query step should require a tool call.");
  assert(
    JSON.stringify(afterQuery?.activeTools) === JSON.stringify(RENDER_TOOLS),
    "A post-query step should only expose render tools."
  );

  const afterRender = controls.prepareStep({ steps: [{ toolCalls: [{ toolName: "render_correlation_network" }] }] });
  assert(afterRender === undefined, "A post-render step should not add another forced render.");

  const shouldStopAfterRender = await controls.stopWhen[0]({
    steps: [{ toolCalls: [{ toolName: "render_correlation_network" }] }],
  } as any);
  assert(shouldStopAfterRender === true, "The stream should stop after a render tool call.");

  const shouldContinueAfterQuery = await controls.stopWhen[0]({
    steps: [{ toolCalls: [{ toolName: "query_correlations" }] }],
  } as any);
  assert(shouldContinueAfterQuery === false, "The stream should not stop after a query-only step.");

  const compacted = compactMarketIntelMessages([
    {
      role: "user",
      content: "show a heatmap",
    },
    {
      role: "tool",
      content: [{ toolName: "render_spread_heatmap", output: { rows: Array.from({ length: 300 }, (_, i) => ({ i })) } }],
    },
    {
      role: "user",
      content: "now drill into that cell",
    },
  ]);
  const olderOutput = (compacted[1] as any).content[0].output.rows;
  assert(olderOutput.__compacted === true, "Older row arrays should be compacted before the next model turn.");
  assert(olderOutput.rowCount === 300, "Compacted row arrays should retain their row count.");
  assert((compacted[2] as any).content === "now drill into that cell", "The latest user turn must remain unchanged.");

  console.log("stream controls ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
