import type { Metadata } from "next";
import localFont from "next/font/local";
import { getSiteOrigin } from "@/lib/site-url";
import "./globals.css";

const spaceGroteskDisplay = localFont({
  src: [
    {
      path: "./fonts/space-grotesk-400.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/space-grotesk-500.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/space-grotesk-700.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-display",
});

const spaceGroteskSans = localFont({
  src: [
    {
      path: "./fonts/space-grotesk-400.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/space-grotesk-500.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/space-grotesk-700.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-sans",
});

const jetBrainsMono = localFont({
  src: [
    {
      path: "./fonts/jetbrains-mono-400.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/jetbrains-mono-500.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "./fonts/jetbrains-mono-600.ttf",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-mono",
});

const siteOrigin = getSiteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "Cerul",
    template: "%s | Cerul",
  },
  description:
    "Video understanding search API for AI agents. Search what is shown in videos, not just what is said.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Cerul",
    description:
      "Video understanding search API for AI agents. Search what is shown in videos, not just what is said.",
    url: siteOrigin,
    siteName: "Cerul",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cerul",
    description:
      "Video understanding search API for AI agents. Search what is shown in videos, not just what is said.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGroteskDisplay.variable} ${spaceGroteskSans.variable} ${jetBrainsMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
