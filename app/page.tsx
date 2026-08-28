export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Yad2 Apartment Alerts</h1>
      <p>
        This app checks Yad2 for rental apartments near Kfar HaRif (≤ ₪5500/month,
        within ~20km) and sends a WhatsApp alert for new listings.
      </p>
      <p>
        It has no UI of its own &mdash; it runs on a schedule and hits{" "}
        <code>/api/check</code> (requires a secret). See the README for setup.
      </p>
    </main>
  );
}
