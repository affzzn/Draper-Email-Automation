"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopNav() {
  const path = usePathname();
  const isActive = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  return (
    <nav className="topnav">
      <div className="brand">
        <span className="brandname">Draper London</span>
        <span className="badge">SHADOW MODE · NOTHING SENDS</span>
      </div>
      <div className="tabs">
        <Link href="/" className={`tab ${isActive("/") ? "active" : ""}`}>
          Enquiries
        </Link>
        <Link
          href="/properties"
          className={`tab ${isActive("/properties") ? "active" : ""}`}
        >
          Properties
        </Link>
      </div>
    </nav>
  );
}
