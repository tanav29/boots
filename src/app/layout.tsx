import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minimi — a conversation with context",
  description: "A thoughtful chat agent with conversation memory, live web research, and voice.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
