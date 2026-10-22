import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Insta Manager",
  description: "Посты, комментарии, статистика и транскрипты из Instagram — с выгрузкой в JSON",
};

/** Applies the saved theme before first paint so there is no light/dark flash. */
const noFlash = `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body>
        <header className="topbar">
          <div className="brand">
            insta<span>·</span>manager
          </div>
          <Nav />
          <ThemeToggle />
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
