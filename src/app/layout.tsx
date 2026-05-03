import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Reddit Upvoted GIF Grid",
  description: "View your upvoted Reddit GIFs in a beautiful masonry grid",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <nav className="navbar">
          <div className="container">
            <div className="logo">
              Reddit<span>GIF Grid</span>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
