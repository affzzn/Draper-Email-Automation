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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/draper-logo.png" alt="Draper London" className="logo-img" />
        <span className="brand-sub">Enquiry Assistant</span>
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
        <Link
          href="/playground"
          className={`tab ${isActive("/playground") ? "active" : ""}`}
        >
          Playground
        </Link>
      </div>
    </nav>
  );
}
