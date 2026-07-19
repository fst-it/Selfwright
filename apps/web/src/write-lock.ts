// Serializes the read -> hash-check -> write -> commit critical section
// across EVERY write route in this app (all under api/*.ts since the T5.10
// clean cutover deleted the SSR form-POST write routes this module
// originally also serialized against). Extracted to its own module (T5.9)
// so every write route shares exactly one queue instance instead of each
// racing an independent one.
//
// Two reasons a per-route or per-file lock is not enough: (1) the data dir is
// a single git repository, so two concurrent `git commit` calls collide on
// the same `.git/index.lock` regardless of which file they touch; (2)
// without serialization, a request that read the file before a concurrent
// request's commit landed still holds a *stale* pre-write snapshot when its
// own commit fails (e.g. on that index-lock contention) and it "fail-closed"
// reverts — reverting to its own stale snapshot silently clobbers the other
// request's already-committed change in the working tree, leaving it out of
// sync with HEAD. Serializing means the loser re-reads fresh content after
// acquiring the lock, so a hash that was valid when the page loaded correctly
// turns into a 409 instead of a corrupt working tree.
let writeQueue: Promise<unknown> = Promise.resolve();

export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
