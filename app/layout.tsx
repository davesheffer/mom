export const metadata = {
  title: "Yad2 Apartment Alerts",
  description: "Hourly Yad2 rental alerts near Kfar HaRif",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
