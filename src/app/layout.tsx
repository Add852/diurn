import type { Metadata, Viewport } from "next";
import "./globals.css";
import { NavBar } from "@/components/bottom-nav";

export const metadata: Metadata = {
  title: "Diurn",
  description: "Self-hosted daily journaling companion",
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        <NavBar />
        <main className="md:ml-48 px-4 pt-4 pb-4 max-w-3xl mx-auto md:max-w-none md:mx-0 lg:mr-8">{children}</main>
      </body>
    </html>
  );
}