import type { Metadata } from "next";
import "./globals.css";
import { Rajdhani } from "next/font/google";
import { cn } from "@/lib/utils";

const rajdhani = Rajdhani({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-sans' });

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
    <html lang="en" className={cn("font-sans", rajdhani.variable)}>
      <body>{children}</body>
    </html>
  );
}