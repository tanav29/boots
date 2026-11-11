import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Minimi — a conversation with context",
  description: "A thoughtful chat agent with conversation memory, live web research, and voice.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-white font-sans text-sm text-zinc-800 antialiased selection:bg-violet-100 [&_button]:cursor-pointer [&_button:disabled]:cursor-default [&_button:disabled]:opacity-40 [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-violet-500">
        {children}
      </body>
    </html>
  );
}
