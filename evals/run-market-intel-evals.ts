import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { streamText, stepCountIs, tool, type ToolSet } from "ai";
import * as braintrust from "braintrust";
import { z } from "zod";
import { buildMarketIntelTools, systemPrompt } from "../src/lib/agent-tools";
import { adversarialDataset, coreDataset, type MarketIntelEvalCase } from "./market-intel.dataset";

type ModelName = "terra" | "claude";
type BatchName = "core" | "adversarial";

type TrialOutput = {
  model: ModelName;
  batch: BatchName;
  trial: number;
  caseId: string;
  input: string;
  expectedTools: string[];
  mode: string;
  calledTools: string[];
  text: string;
  finishReason: string;
  renderTool?: string;
  renderInput?: Record<string, unknown>;
  renderOutput?: Record<string, unknown>;
  scores: Record<string, number>;
  notes: string[];
  error?: string;
};

type RunSummary = {
  generatedAt: string;
  projectName: string;
  braintrustLogged: boolean;
  resultsPath: string;
  runs: Array<{
    model: ModelName;
    batch: BatchName;
    trials: number;
    cases: number;
    total: number;
    passRate: number;
    scoreAverages: Record<string, number>;
    failures: Array<{ caseId: string; trial: number; failed: string[]; notes: string[] }>;
  }>;
};

const PROJECT_NAME = "Market Intel Tool Contract";
const RESULTS_DIR = "evals/results";
const RESULT_PATH = `${RESULTS_DIR}/market-intel-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

const RENDER_TOOLS = new Set([
  "render_candlestick",
  "render_spread_heatmap",
  "render_volatility_bands",
  "render_correlation_network",
  "render_verdict_card",
]);

function parseArgs() {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    args.set(key, value);
  }
  return {
    mode: args.get("mode") ?? "all",
    terraTrials: Number(args.get("terra-trials") ?? 3),
    resultsPath: args.get("out") ?? RESULT_PATH,
  };
}

function modelFor(name: ModelName) {
  if (name === "claude") return anthropic("claude-sonnet-5");
  return openai("gpt-5.5");
}

function sampleRows(name: string, evalCase: MarketIntelEvalCase) {
  if (evalCase.noData && name.startsWith("query_")) return [];

  switch (name) {
    case "query_recent_events":
      return [
        {
          event_type: "volatility_spike",
          window_start: "2026-07-20 18:40:00.000",
          window_end: "2026-07-20 18:41:00.000",
          severity: 3.4,
          detail: JSON.stringify({ last_ret: 0.012, trailing_stddev: 0.0035 }),
        },
      ];
    case "query_price_series":
      return [
        { minute: "2026-07-20 18:40:00", open: 65000, high: 65040, low: 64980, close: 65020, volume: 1.2 },
        { minute: "2026-07-20 18:41:00", open: 65020, high: 65080, low: 65010, close: 65070, volume: 1.6 },
        { minute: "2026-07-20 18:42:00", open: 65070, high: 65090, low: 65025, close: 65035, volume: 0.9 },
      ];
    case "query_spread_series":
      return [
        {
          symbol: "BTC-USD",
          timestamp: "2026-07-20 18:44:08.368",
          exchange_a: "coinbase",
          bid_a: 65327.37,
          ask_a: 65327.38,
          exchange_b: "kraken",
          bid_b: 65332.5,
          ask_b: 65332.6,
          time_delta_ms: 208,
          spread_a_over_b: -5.23,
        },
      ];
    case "query_orderbook_at":
      return [{ exchange: "kraken", symbol: "BTC-USD", timestamp: "2026-07-20 18:44:08.300", best_bid: 65332.5, best_ask: 65332.6 }];
    case "query_trades_around":
      return [
        { exchange: "coinbase", symbol: "BTC-USD", trade_id: "eval-cb-1", price: 65327.4, size: 0.01, side: "buy", timestamp: "2026-07-20 18:44:08.200" },
        { exchange: "kraken", symbol: "BTC-USD", trade_id: "eval-kr-1", price: 65332.6, size: 0.02, side: "sell", timestamp: "2026-07-20 18:44:08.410" },
      ];
    case "query_correlations":
      return [
        { symbol: "BTC-USD", minute: "2026-07-20 18:40:00", close: 65000 },
        { symbol: "BTC-USD", minute: "2026-07-20 18:41:00", close: 65010 },
        { symbol: "BTC-USD", minute: "2026-07-20 18:42:00", close: 65030 },
        { symbol: "ETH-USD", minute: "2026-07-20 18:40:00", close: 1900 },
        { symbol: "ETH-USD", minute: "2026-07-20 18:41:00", close: 1901 },
        { symbol: "ETH-USD", minute: "2026-07-20 18:42:00", close: 1903 },
        { symbol: "SOL-USD", minute: "2026-07-20 18:40:00", close: 77 },
        { symbol: "SOL-USD", minute: "2026-07-20 18:41:00", close: 77.05 },
        { symbol: "SOL-USD", minute: "2026-07-20 18:42:00", close: 77.1 },
      ];
    default:
      return [];
  }
}

function noDataVerdictOutput(subject: string) {
  return {
    __renderAs: "verdict_card",
    verdict: `No data is available for ${subject} in the requested window.`,
    confidence: 0.99,
    stats: [{ label: "Rows", value: "0" }],
    caption: "No visualization rendered because the underlying query returned zero rows.",
  };
}

function makeEvalTools(evalCase: MarketIntelEvalCase): ToolSet {
  const realTools = buildMarketIntelTools(`braintrust-eval-${evalCase.id}`);
  return Object.fromEntries(
    Object.entries(realTools).map(([name, realTool]) => {
      return [
        name,
        tool({
          description: realTool.description,
          inputSchema: realTool.inputSchema as z.ZodTypeAny,
          execute: async (input: unknown) => {
            if (name.startsWith("query_")) return sampleRows(name, evalCase);
            if (name === "save_investigation") return { saved: true, eval_stub: true };
            if (name === "set_alert") return { approval_required: true, eval_stub: true };
            if (name === "render_candlestick") {
              const ohlc = sampleRows("query_price_series", evalCase);
              if (ohlc.length === 0) return noDataVerdictOutput("the requested price series");
              return { input, ohlc };
            }
            if (name === "render_spread_heatmap") {
              const rows = sampleRows("query_spread_series", evalCase);
              if (rows.length === 0) return noDataVerdictOutput("the requested spread series");
              return { input, rows };
            }
            if (name === "render_volatility_bands") return { input, ohlc: sampleRows("query_price_series", evalCase) };
            if (name === "render_correlation_network") {
              const rows = sampleRows("query_correlations", evalCase);
              if (rows.length === 0) return noDataVerdictOutput("the requested correlation series");
              return {
                input,
                symbols: ["BTC-USD", "ETH-USD", "SOL-USD"],
                rows,
                correlations: [
                  { source: "BTC-USD", target: "ETH-USD", correlation: 0.76, samples: 60, series: [] },
                  { source: "BTC-USD", target: "SOL-USD", correlation: 0.71, samples: 60, series: [] },
                ],
              };
            }
            if (name === "render_verdict_card") return input;
            return { ok: true, eval_stub: true };
          },
        }),
      ];
    })
  ) as ToolSet;
}

function toolName(call: unknown): string {
  const c = call as { toolName?: string; type?: string; toolCallType?: string };
  return c.toolName ?? c.type ?? c.toolCallType ?? "unknown";
}

function toolInput(call: unknown): Record<string, unknown> | undefined {
  const c = call as { input?: Record<string, unknown>; args?: Record<string, unknown> };
  return c.input ?? c.args;
}

function toolResultOutput(result: unknown): Record<string, unknown> | undefined {
  const r = result as { output?: Record<string, unknown>; result?: Record<string, unknown> };
  return r.output ?? r.result;
}

function isVerdictCardShape(value?: Record<string, unknown>) {
  return value?.__renderAs === "verdict_card" || typeof value?.verdict === "string";
}

function hasRawJsonText(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || /"tool(Call|Name|Result|Input)"\s*:/.test(trimmed);
}

function scoreCase(
  evalCase: MarketIntelEvalCase,
  calledTools: string[],
  text: string,
  renderInput?: Record<string, unknown>,
  renderOutput?: Record<string, unknown>
) {
  const notes: string[] = [];
  const expected = evalCase.expectedTools;
  const effectiveCalledTools = isVerdictCardShape(renderOutput) && !calledTools.includes("render_verdict_card")
    ? [...calledTools, "render_verdict_card"]
    : calledTools;
  const exactToolSelected =
    evalCase.mode === "exact"
      ? expected.every((name) => effectiveCalledTools.includes(name))
      : expected.some((name) => effectiveCalledTools.includes(name)) || effectiveCalledTools.some((name) => RENDER_TOOLS.has(name));
  if (!exactToolSelected) notes.push(`Expected ${expected.join(", ")}; saw ${calledTools.join(", ") || "none"}`);

  const zeroProseLeakage = text.trim().length === 0 ? 1 : 0;
  if (!zeroProseLeakage) notes.push(`Text leaked: ${JSON.stringify(text.slice(0, 180))}`);

  const caption = typeof renderInput?.caption === "string" ? renderInput.caption : "";
  const captionUnder160 = !caption || caption.length <= 160 ? 1 : 0;
  if (!captionUnder160) notes.push(`Caption length ${caption.length}`);

  let noDataHonesty = 1;
  if (evalCase.noData) {
    const verdict = `${renderInput?.verdict ?? ""} ${renderInput?.caption ?? ""} ${renderOutput?.verdict ?? ""} ${renderOutput?.caption ?? ""}`.toLowerCase();
    noDataHonesty =
      effectiveCalledTools.includes("render_verdict_card") && /(no|not|unavailable|empty|insufficient|couldn't|cannot|can't|data)/.test(verdict) ? 1 : 0;
    if (!noDataHonesty) notes.push("No-data case did not render an honest verdict card");
  }

  let adversarialSafety = 1;
  if (evalCase.adversarial) {
    adversarialSafety = zeroProseLeakage && !hasRawJsonText(text) && calledTools.some((name) => RENDER_TOOLS.has(name)) ? 1 : 0;
    if (!adversarialSafety) notes.push("Adversarial safety failed");
  }

  return {
    scores: {
      correct_tool_selected: exactToolSelected ? 1 : 0,
      zero_prose_leakage: zeroProseLeakage,
      caption_under_160: captionUnder160,
      no_data_honesty: noDataHonesty,
      adversarial_safety: adversarialSafety,
    },
    notes,
  };
}

async function runOne(evalCase: MarketIntelEvalCase, modelName: ModelName, batch: BatchName, trial: number): Promise<TrialOutput> {
  try {
    const result = streamText({
      model: modelFor(modelName),
      system: systemPrompt(),
      messages: [{ role: "user", content: evalCase.input }],
      tools: makeEvalTools(evalCase),
      stopWhen: stepCountIs(15),
    });

    const [calls, toolResults, text, finishReason] = await Promise.all([
      result.toolCalls,
      result.toolResults,
      result.text,
      result.finishReason,
    ]);
    const calledTools = calls.map(toolName);
    const lastRender = [...calls].reverse().find((call) => RENDER_TOOLS.has(toolName(call)));
    const renderTool = lastRender ? toolName(lastRender) : undefined;
    const renderInput = lastRender ? toolInput(lastRender) : undefined;
    const lastRenderResult = [...toolResults].reverse().find((result) => RENDER_TOOLS.has(toolName(result)));
    const renderOutput = lastRenderResult ? toolResultOutput(lastRenderResult) : undefined;
    const scored = scoreCase(evalCase, calledTools, text, renderInput, renderOutput);
    return {
      model: modelName,
      batch,
      trial,
      caseId: evalCase.id,
      input: evalCase.input,
      expectedTools: evalCase.expectedTools,
      mode: evalCase.mode,
      calledTools,
      text,
      finishReason,
      renderTool,
      renderInput,
      renderOutput,
      ...scored,
    };
  } catch (err) {
    return {
      model: modelName,
      batch,
      trial,
      caseId: evalCase.id,
      input: evalCase.input,
      expectedTools: evalCase.expectedTools,
      mode: evalCase.mode,
      calledTools: [],
      text: "",
      finishReason: "error",
      scores: {
        correct_tool_selected: 0,
        zero_prose_leakage: 0,
        caption_under_160: 0,
        no_data_honesty: evalCase.noData ? 0 : 1,
        adversarial_safety: evalCase.adversarial ? 0 : 1,
      },
      notes: ["Execution error"],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function maybeBraintrustExperiment(name: string) {
  if (!process.env.BRAINTRUST_API_KEY) return null;
  return braintrust.init(PROJECT_NAME, {
    apiKey: process.env.BRAINTRUST_API_KEY,
    experiment: name,
  });
}

async function logBraintrust(experiment: Awaited<ReturnType<typeof maybeBraintrustExperiment>>, result: TrialOutput) {
  if (!experiment) return;
  experiment.log({
    input: result.input,
      output: {
        calledTools: result.calledTools,
        text: result.text,
        renderTool: result.renderTool,
        renderInput: result.renderInput,
        renderOutput: result.renderOutput,
        finishReason: result.finishReason,
        error: result.error,
      },
    expected: result.expectedTools,
    scores: result.scores,
    metadata: {
      caseId: result.caseId,
      model: result.model,
      batch: result.batch,
      trial: result.trial,
      mode: result.mode,
      notes: result.notes,
    },
  });
}

function summarize(model: ModelName, batch: BatchName, trials: number, cases: MarketIntelEvalCase[], results: TrialOutput[]) {
  const scoreNames = ["correct_tool_selected", "zero_prose_leakage", "caption_under_160", "no_data_honesty", "adversarial_safety"];
  const relevantResults = results.filter((r) => r.model === model && r.batch === batch);
  const allPass = relevantResults.filter((r) => Object.values(r.scores).every((score) => score === 1)).length;
  const scoreAverages = Object.fromEntries(
    scoreNames.map((name) => [
      name,
      relevantResults.length ? relevantResults.reduce((sum, r) => sum + (r.scores[name] ?? 1), 0) / relevantResults.length : 0,
    ])
  );
  return {
    model,
    batch,
    trials,
    cases: cases.length,
    total: relevantResults.length,
    passRate: relevantResults.length ? allPass / relevantResults.length : 0,
    scoreAverages,
    failures: relevantResults
      .filter((r) => Object.values(r.scores).some((score) => score !== 1))
      .map((r) => ({
        caseId: r.caseId,
        trial: r.trial,
        failed: Object.entries(r.scores).filter(([, score]) => score !== 1).map(([name]) => name),
        notes: r.error ? [...r.notes, r.error] : r.notes,
      })),
  };
}

async function runBatch(model: ModelName, batch: BatchName, cases: MarketIntelEvalCase[], trials: number) {
  const experiment = await maybeBraintrustExperiment(`${model}-${batch}-${new Date().toISOString()}`);
  const results: TrialOutput[] = [];
  for (let trial = 1; trial <= trials; trial++) {
    for (const evalCase of cases) {
      process.stdout.write(`[${model}/${batch}] trial ${trial}/${trials} ${evalCase.id}\n`);
      const output = await runOne(evalCase, model, batch, trial);
      results.push(output);
      await logBraintrust(experiment, output);
    }
  }
  if (experiment) {
    console.log(await experiment.summarize());
    await braintrust.flush();
  }
  return results;
}

async function main() {
  const args = parseArgs();
  const allResults: TrialOutput[] = [];

  if (args.mode === "all" || args.mode === "terra-core") {
    if (process.env.OPENAI_API_KEY) {
      allResults.push(...(await runBatch("terra", "core", coreDataset, args.terraTrials)));
    } else {
      console.warn("Skipping terra-core: OPENAI_API_KEY is not set.");
    }
  }
  if (args.mode === "all" || args.mode === "claude-core") {
    if (process.env.ANTHROPIC_API_KEY) {
      allResults.push(...(await runBatch("claude", "core", coreDataset, 1)));
    } else {
      console.warn("Skipping claude-core: ANTHROPIC_API_KEY is not set.");
    }
  }
  if (args.mode === "all" || args.mode === "terra-adversarial") {
    if (process.env.OPENAI_API_KEY) {
      allResults.push(...(await runBatch("terra", "adversarial", adversarialDataset, 1)));
    } else {
      console.warn("Skipping terra-adversarial: OPENAI_API_KEY is not set.");
    }
  }

  const summaries = [
    summarize("terra", "core", process.env.OPENAI_API_KEY ? args.terraTrials : 0, coreDataset, allResults),
    summarize("claude", "core", process.env.ANTHROPIC_API_KEY ? 1 : 0, coreDataset, allResults),
    summarize("terra", "adversarial", process.env.OPENAI_API_KEY ? 1 : 0, adversarialDataset, allResults),
  ].filter((summary) => summary.total > 0 || summary.model === "claude");

  const report: RunSummary & { results: TrialOutput[] } = {
    generatedAt: new Date().toISOString(),
    projectName: PROJECT_NAME,
    braintrustLogged: Boolean(process.env.BRAINTRUST_API_KEY),
    resultsPath: args.resultsPath,
    runs: summaries,
    results: allResults,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  await writeFile(args.resultsPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.runs, null, 2));
  console.log(`Wrote ${args.resultsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
