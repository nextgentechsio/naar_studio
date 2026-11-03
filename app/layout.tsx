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

// Some browser extensions stamp bis_skin_checked on
// every element before React loads, which React reports
// as a hydration mismatch. Removed as they appear, until
// the page has loaded and hydrated. (The same extension
// keeps its settings in bis_register on <body>: that one
// stays, and <body> ignores extra attributes instead.)
// Part of the one head script: such an extension also
// inserts its own <script> into the head, and a second
// script of ours would be compared against that one.
const EXTENSION_ATTRIBUTES = ["bis_skin_checked"];
const CLEAN_SCRIPT = `(function(){try{var a=${JSON.stringify(EXTENSION_ATTRIBUTES)};function c(n){for(var i=0;i<a.length;i++)if(n.hasAttribute&&n.hasAttribute(a[i]))n.removeAttribute(a[i])}var o=new MutationObserver(function(m){for(var i=0;i<m.length;i++)c(m[i].target)});o.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:a});addEventListener("load",function(){setTimeout(function(){o.disconnect()},3000)})}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lufga.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + ";" + CLEAN_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
