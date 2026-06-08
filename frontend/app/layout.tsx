import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brassworks Launcher",
  description: "Launcher for the Brassworks SMP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
