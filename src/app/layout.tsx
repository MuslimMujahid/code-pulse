import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodePulse",
  description: "Transform your git history into an interactive force graph",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
