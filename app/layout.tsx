import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { APP_NAME, COMPANY } from "@/lib/app-info";
import "./globals.css";

// NAAR brand typeface (same files as about.naar.io)
const lufga = localFont({
  src: [
    { path: "./fonts/LufgaRegular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/LufgaMedium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/LufgaSemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/LufgaBold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-lufga",
  display: "swap",
});

// Prices and numbers
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  applicationName: APP_NAME,
  description: `${COMPANY}'s AI generation workspace with per-project spend tracking.`,
  authors: [{ name: COMPANY }],
};

// Apply the saved theme and sidebar state before first
// paint (no flash). No saved theme = follow the OS.
const THEME_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem("theme");if(t==="light"||t==="dark")d.setAttribute("data-theme",t);if(localStorage.getItem("sidebar")==="collapsed")d.setAttribute("data-sidebar","collapsed")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lufga.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
