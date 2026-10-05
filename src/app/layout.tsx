import type { Metadata, Viewport } from "next";
import { Cairo, Geist, Geist_Mono } from "next/font/google";

import { I18nProvider } from "@/components/i18n-provider";
import { OfflineBanner } from "@/components/offline-banner";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { UpdatePrompt } from "@/components/update-prompt";
import { htmlLang } from "@/lib/i18n/config";
import { getDictionary, getDirection, getLocale } from "@/lib/i18n/server";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    title: {
      default: dict.common.appName,
      template: `%s · ${dict.common.appName}`,
    },
    description: dict.landing.heroBody,
    applicationName: dict.common.appName,
    appleWebApp: {
      capable: true,
      title: dict.common.appName,
      statusBarStyle: "black-translucent",
    },
    formatDetection: {
      telephone: false,
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#07090f" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Without this the browser keeps content out of the notch itself and every
  // env(safe-area-inset-*) reads zero, which is what the safe-t and safe-b
  // paddings across the app are waiting for.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, dict, direction] = await Promise.all([
    getLocale(),
    getDictionary(),
    getDirection(),
  ]);

  return (
    <html
      lang={htmlLang[locale]}
      dir={direction}
      className={`${geistSans.variable} ${geistMono.variable} ${cairo.variable} h-full antialiased`}
    >
      {/* Every attribute on this element is a static literal and children is
          passed straight through from the server render, so there is nothing
          here that can legitimately mismatch. A browser extension injecting
          `data-smart-converter-loaded` onto <body> is the only realistic
          source of a diff, and it is not ours to fix. */}
      <body
        className="min-h-full flex flex-col bg-canvas text-ink"
        suppressHydrationWarning
      >
        <I18nProvider dict={dict} locale={locale}>
          <ServiceWorkerRegister />
          <OfflineBanner />
          <UpdatePrompt />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
