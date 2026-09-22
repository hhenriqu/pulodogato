// Layout para páginas de autenticação
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-primary/10">
      {children}
    </div>
  );
}
