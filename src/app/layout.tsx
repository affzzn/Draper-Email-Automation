import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Draper London Enquiries",
  description: "Shadow mode enquiry review. Nothing is sent.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
