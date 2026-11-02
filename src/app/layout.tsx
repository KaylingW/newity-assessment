import type { Metadata } from "next";
import Link from "next/link";
import { AS_OF_DATE } from "@/lib/config";
import { formatDate } from "@/lib/rules";
import "./globals.css";

export const metadata: Metadata = {
  title: "SBA Document Checklist",
  description: "Track SBA loan document checklists and spot stalled applications.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            SBA Document Checklist
          </Link>
          <span className="as-of" title="All expiry and stalled checks use this date">
            Today is treated as <strong>{formatDate(AS_OF_DATE)}</strong>
          </span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
