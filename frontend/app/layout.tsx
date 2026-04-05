import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AuraGate PoC Dashboard",
  description: "Omni-Channel Escalation simulation for residential gate security",
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