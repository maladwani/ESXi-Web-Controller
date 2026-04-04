import type { Metadata } from "next";
import { DM_Sans, Syne } from "next/font/google";
import { Providers } from "@/app/providers";
import "./globals.css";

const display = Syne({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "ESXi Web Manager",
  description: "Manage VMware ESXi virtual machines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} min-h-screen bg-[#020617] font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
