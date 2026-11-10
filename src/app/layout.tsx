import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Job Searcher",
  description: "Personal IT job search tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
