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
        <span className="logo" aria-label="Draper London">
          <svg viewBox="0 0 44 48" fill="none" stroke="currentColor" strokeWidth={4.4} strokeLinecap="round">
            <path d="M9 6 v36" />
            <path d="M9 6 a18 18 0 0 1 0 36" />
            <path d="M9 13 a11 11 0 0 1 0 22" />
            <path d="M9 20 a4.5 4.5 0 0 1 0 8" />
          </svg>
          <span className="word">
            <span className="d">DRAPER</span>
            <span className="l">LONDON</span>
          </span>
        </span>
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
