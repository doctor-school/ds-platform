import Link from 'next/link';

export default function Home() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="mb-4 text-4xl font-bold">DS Platform Docs</h1>
      <p className="mb-8 text-lg text-fd-muted-foreground">
        Architecture decisions, design specs, and engineering reference for the
        Doctor.School Platform.
      </p>
      <ul className="space-y-2">
        <li>
          <Link
            className="text-fd-primary hover:underline"
            href="/adr/0001-identity-provider-shortlist-en"
          >
            Browse ADRs →
          </Link>
        </li>
        <li>
          <Link
            className="text-fd-primary hover:underline"
            href="/adr/0008-repo-strategy-and-dev-workflow-en"
          >
            Repository strategy (ADR-0008) →
          </Link>
        </li>
        <li>
          <Link
            className="text-fd-primary hover:underline"
            href="/adr/0007-ai-stack-en"
          >
            AI development stack (ADR-0007) →
          </Link>
        </li>
      </ul>
    </main>
  );
}
