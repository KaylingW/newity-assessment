"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", icon: "▤", label: "Applications", match: (p: string) => p === "/" || p.startsWith("/applications") },
  { href: "/outstanding", icon: "☷", label: "Outstanding items", match: (p: string) => p.startsWith("/outstanding") },
];

export default function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 lg:flex-col lg:gap-2.5">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-10 items-center gap-2.5 rounded-[9px] px-4 text-sm text-nav-text transition-colors ${
              active ? "bg-nav-active font-semibold" : "hover:bg-nav-active/50"
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
