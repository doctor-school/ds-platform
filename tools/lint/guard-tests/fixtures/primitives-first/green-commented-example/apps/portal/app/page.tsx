/**
 * GREEN: the only state-stack tags live inside comments — commented-out code
 * and doc examples must not trip the guard (comment-blanking, the #269
 * comment-mask lesson):
 *
 *   <a href="/x" className="underline hover:opacity-80">bad example</a>
 */
export default function Page() {
  // <button type="button" className="hover:bg-muted">old row</button>
  return <main>Nothing interactive here.</main>;
}
