import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavBar } from "@/components/bottom-nav";
import { ScrollReset } from "@/components/scroll-reset";
import { maybeBackgroundScan } from "@/lib/media-cache";

export const metadata: Metadata = {
  title: "Diurn",
  description: "Self-hosted daily journaling companion",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: layout resizes with keyboard instead of panning fixed nav around
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  maybeBackgroundScan();

  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden">
        <ScrollReset />
        <NavBar />
        <main className="h-full overflow-y-auto overscroll-none md:ml-48 px-4 pt-4 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-4 max-w-3xl mx-auto md:max-w-none md:mx-0 lg:mr-8">{children}</main>
      </body>
    </html>
  );
}