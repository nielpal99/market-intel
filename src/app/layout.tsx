import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Market Intel",
  description: "Live market intelligence chat agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0b0c10", color: "#e0e0e0", fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
