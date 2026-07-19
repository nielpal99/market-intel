import { Chat } from "@/components/Chat";

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1>Market Intel</h1>
      <p>Ask about BTC, ETH, SOL. Answers are rendered widgets, not prose.</p>
      <Chat />
    </main>
  );
}
