"use client";

import { useRouter } from "next/navigation";

/**
 * A table row that opens `href` when clicked anywhere. The row's own links still work as normal
 * (and stay the keyboard / screen reader path); Cmd/Ctrl-click opens a new tab.
 */
export default function ClickableRow({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer ${className ?? ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
        if (window.getSelection()?.toString()) return; // let people select text without navigating
        if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
        else router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
