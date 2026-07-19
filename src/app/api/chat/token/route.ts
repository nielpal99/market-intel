import { chat } from "@trigger.dev/sdk/ai";

export async function POST() {
  const token = await chat.createAccessToken("market-intel");
  return Response.json({ token });
}
