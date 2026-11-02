import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import logo from "@/assets/newity-logo.svg";
import SideNav from "@/components/SideNav";
import { AS_OF_DATE } from "@/lib/config";
import { getDb, listProcessors } from "@/lib/db";
import { formatDate } from "@/lib/rules";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "NEWITY — SBA document management",
  description: "Track SBA loan document checklists and spot stalled applications.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const teamSize = listProcessors(getDb()).length;
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="sticky top-0 z-10 flex min-h-[76px] flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-navbar px-5 py-3 lg:h-[76px] lg:flex-nowrap lg:py-0 lg:pl-[27px] lg:pr-10">
          <Link href="/" className="shrink-0 lg:w-[231px]">
            <Image src={logo} alt="NEWITY" priority className="h-[30px] w-[171px]" />
          </Link>
          <span className="text-[15px] font-semibold text-text">Loan Operations</span>
          <span className="ml-auto hidden text-xs text-muted sm:inline">
            <span title="All expiry and stalled checks use this date">
              As of <strong className="font-semibold text-text">{formatDate(AS_OF_DATE)}</strong>
            </span>
            <span className="mx-2">•</span>
            Operations team<span className="mx-2">•</span>
            {teamSize} members
          </span>
        </header>

        <div className="lg:flex">
          <aside className="flex flex-col bg-sidebar px-[13px] py-3 lg:sticky lg:top-[76px] lg:h-[calc(100vh-76px)] lg:w-[222px] lg:shrink-0 lg:pb-7 lg:pt-[25px]">
            <SideNav />
            <p className="mt-auto hidden px-4 text-[10px] font-semibold tracking-wide text-nav-muted lg:block">
              INTERNAL WORKSPACE
            </p>
          </aside>
          <main className="mx-auto min-w-0 max-w-[1206px] flex-1 px-6 pb-12 pt-8 lg:px-10 lg:pt-9">{children}</main>
        </div>
      </body>
    </html>
  );
}
