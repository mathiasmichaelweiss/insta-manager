"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/posts", label: "Посты" },
  { href: "/topics", label: "Темы" },
  { href: "/messages", label: "Директ" },
  { href: "/drafts", label: "Черновики" },
  { href: "/settings", label: "Настройки" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} data-active={pathname.startsWith(link.href)}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
