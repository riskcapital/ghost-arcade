/** Owns a queued intention from preparation through native acknowledgement. */
export type LaunchReceipt = { id: string; state: string; age_ms?: number };
export function createNativeQueuedLaunches<T>(deps: {
  prepare(value: T, isCurrent: () => boolean): Promise<unknown | null>;
  release?(value: T): void;
  resources?(value: T): readonly string[];
  submit(value: T, prepared: unknown, revision: number): Promise<void>;
  cancel(value: T, revision: number): Promise<LaunchReceipt[] | void>;
  receipts(): Promise<LaunchReceipt[]>;
  applied(value: T, receipt: LaunchReceipt, cancelled?: boolean): void;
  failed(value: T, message: string): void;
}) {
  type Job = { value:T; signature:string; revision:number; valid:boolean; submitted:boolean;
    cancelRevision?:number; cancelling?:boolean; retryAt?:number; failure?:string;
    preparing:boolean; finish?:()=>void; resources:readonly string[]; preparedDone:Promise<void>; resolvePrepared:()=>void };
  let revision = Date.now();
  const jobs = new Map<string, Job>();
  const attempted = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  function pollLater() { if (!timer && jobs.size) timer = setTimeout(() => { timer=undefined; void poll(); }, 20); }
  function settle(id:string,job:Job,complete:()=>void = ()=>{}) {
    if (jobs.get(id)!==job) return;
    job.finish ??= complete;
    // A cancellation acknowledgement fences native enqueue, but cannot stop
    // an already-running preparation write. Keep fallback/cleanup blocked
    // until that write settles as well.
    if (job.preparing) return;
    jobs.delete(id);
    try { job.finish(); } finally { deps.release?.(job.value); }
  }
  function cancelJob(id:string,job:Job) {
    if (job.finish || job.cancelling || (job.retryAt??0)>performance.now()) return;
    job.cancelRevision ??= ++revision;
    job.cancelling=true;
    void deps.cancel(job.value,job.cancelRevision).then(receipts=> {
      if (jobs.get(id)!==job) return;
      settle(id,job,()=> {
        const applied=receipts?.find(receipt=>receipt.id===id && receipt.state==='applied');
        if (applied) deps.applied(job.value,applied,true);
        else if (job.failure && job.valid) deps.failed(job.value,job.failure);
      });
    }).catch(()=> { job.retryAt=performance.now()+250; }).finally(()=> { job.cancelling=false; pollLater(); });
  }
  async function poll() {
    if (polling) return;
    polling=true;
    try {
      for (const [id,job] of jobs) if (!job.valid || job.failure) cancelJob(id,job);
      for (const receipt of await deps.receipts()) {
        const job=jobs.get(receipt.id);
        if (!job || !job.submitted || !job.valid || job.failure) continue;
        settle(receipt.id,job,()=> {
          if (receipt.state==='applied') deps.applied(job.value,receipt,false);
          else deps.failed(job.value,`Native launch ${receipt.state}`);
        });
      }
    } catch { /* An uncertain response never relinquishes launch ownership. */ }
    finally { polling=false; pollLater(); }
  }
  return {
    owns:(id:string)=>jobs.has(id),
    sync(entries:Array<{id:string; signature:string; value:T}>) {
      const current=new Map(entries.map(entry=>[entry.id,entry]));
      for (const [id,job] of jobs) {
        if (!job.valid || current.get(id)?.signature===job.signature) continue;
        job.valid=false;
        cancelJob(id,job);
      }
      for (const entry of entries) {
        if (jobs.has(entry.id) || attempted.has(entry.id)) continue;
        attempted.add(entry.id);
        const resources=deps.resources?.(entry.value)??[];
        const priorPreparations=[...jobs.values()].filter(job=>job.preparing
          && job.resources.some(resource=>resources.includes(resource))).map(job=>job.preparedDone);
        let resolvePrepared!:()=>void;
        const preparedDone=new Promise<void>(resolve=>{resolvePrepared=resolve;});
        const job:Job={value:entry.value,signature:entry.signature,revision:++revision,valid:true,submitted:false,preparing:true,
          resources,preparedDone,resolvePrepared};
        jobs.set(entry.id,job);
        void (async()=> {
          try {
            if (priorPreparations.length) await Promise.all(priorPreparations);
            if (!job.valid) return;
            const prepared=await deps.prepare(entry.value,()=>job.valid && jobs.get(entry.id)===job);
            job.preparing=false;
            job.resolvePrepared();
            if (!job.valid) return;
            if (!prepared) { settle(entry.id,job); return; }
            job.submitted=true;
            await deps.submit(entry.value,prepared,job.revision);
          } catch(error) {
            // A late rejection from an obsolete enqueue must not cancel its replacement.
            if (!job.valid || jobs.get(entry.id)!==job) return;
            if (job.submitted) {
              job.failure=error instanceof Error?error.message:String(error);
              cancelJob(entry.id,job);
            } else settle(entry.id,job);
          } finally {
            job.preparing=false;
            job.resolvePrepared();
            if (job.finish) settle(entry.id,job);
            pollLater();
          }
        })();
      }
      for (const id of attempted) if (!current.has(id) && !jobs.has(id)) attempted.delete(id);
      pollLater();
    },
  };
}
