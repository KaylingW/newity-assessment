"use client";

import { useRouter } from "next/navigation";

export default function ProcessorFilter({
  processors,
  selected,
}: {
  processors: string[];
  selected: string;
}) {
  const router = useRouter();
  return (
    <div>
      <label htmlFor="processor">Show applications for</label>
      <select
        id="processor"
        value={selected}
        onChange={(e) => {
          const value = e.target.value;
          router.push(value ? `/?processor=${encodeURIComponent(value)}` : "/");
        }}
      >
        <option value="">Everyone</option>
        {processors.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}
