export default function RootLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <html lang="ru">
      <body>
        {children}
        <footer>{year}</footer>
      </body>
    </html>
  );
}
