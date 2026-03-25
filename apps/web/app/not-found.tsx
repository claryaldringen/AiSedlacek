export default function RootNotFound(): React.ReactElement {
  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'serif' }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Page not found</h1>
            <a href="/" style={{ color: '#8b1a1a' }}>Go to homepage</a>
          </div>
        </div>
      </body>
    </html>
  );
}
