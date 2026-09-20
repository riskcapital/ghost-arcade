import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeQueuedLaunches } from './nativeQueuedLaunch';
afterEach(()=>vi.useRealTimers());
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>resolve=r);return {promise,resolve}; }
function setup(prepare=vi.fn(async (_value:string)=>({}))) {
  const deps={prepare,resources:vi.fn((_value:string)=>['shared-row']),release:vi.fn(),submit:vi.fn(async()=>{}),cancel:vi.fn<(...args:any[])=>Promise<any>>(async()=>undefined),receipts:vi.fn(async()=>[] as any[]),applied:vi.fn(),failed:vi.fn()};
  const manager=createNativeQueuedLaunches<string>(deps);
  return {deps,manager,entry:{id:'one',signature:'first',value:'clip'}};
}
describe('native queued launch ownership',()=>{
  it('owns preparation and applies the native receipt exactly once',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();manager.sync([entry]);
    expect(manager.owns(entry.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);expect(deps.submit).toHaveBeenCalledOnce();
    deps.receipts.mockResolvedValue([{id:'one',state:'applied',age_ms:40}]);
    await vi.advanceTimersByTimeAsync(60);
    expect(deps.applied).toHaveBeenCalledOnce();expect(deps.cancel).not.toHaveBeenCalled();
    expect(manager.owns(entry.id)).toBe(false);
    manager.sync([entry]);expect(deps.submit).toHaveBeenCalledOnce();
  });
  it('fences cancellation while preparation is outstanding',async()=>{
    vi.useFakeTimers();const ready=deferred<{}>();const {manager,deps,entry}=setup(vi.fn(()=>ready.promise));
    manager.sync([entry]);manager.sync([]);await vi.advanceTimersByTimeAsync(1);
    ready.resolve({});await vi.advanceTimersByTimeAsync(50);
    expect(deps.submit).not.toHaveBeenCalled();expect(deps.cancel).toHaveBeenCalledOnce();
    expect(manager.owns(entry.id)).toBe(false);
  });
  it('retains ownership until cancellation is acknowledged',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();const cancelled=deferred<void>();
    deps.cancel.mockImplementation(()=>cancelled.promise);manager.sync([entry]);await vi.advanceTimersByTimeAsync(1);
    manager.sync([]);manager.sync([]);
    expect(deps.cancel).toHaveBeenCalledOnce();expect(manager.owns(entry.id)).toBe(true);
    cancelled.resolve();await vi.advanceTimersByTimeAsync(1);expect(manager.owns(entry.id)).toBe(false);
  });
  it('returns unsupported preparation to the existing launcher without submitting',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup(vi.fn(async()=>null as any));
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(30);
    expect(manager.owns(entry.id)).toBe(false);expect(deps.submit).not.toHaveBeenCalled();expect(deps.failed).not.toHaveBeenCalled();
  });
  it('waits for cancellation acknowledgement before reconciling a racing receipt',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();const cancelled=deferred<void>();deps.cancel.mockImplementation(()=>cancelled.promise);
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(1);manager.sync([{...entry,signature:'changed'}]);
    deps.receipts.mockResolvedValue([{id:'one',state:'applied'}]);await vi.advanceTimersByTimeAsync(30);
    expect(deps.applied).not.toHaveBeenCalled();cancelled.resolve();
  });
  it('reconciles an applied launch when its enqueue acknowledgement was lost',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();
    deps.submit.mockRejectedValue(new Error('acknowledgement timed out'));
    deps.cancel.mockResolvedValue([{id:'one',state:'applied',age_ms:80}]);
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(30);
    expect(deps.applied).toHaveBeenCalledOnce();expect(deps.failed).not.toHaveBeenCalled();
    expect(manager.owns(entry.id)).toBe(false);
  });
  it('reconciles a launch that executed before the cancellation acknowledgement',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(1);
    deps.cancel.mockResolvedValue([{id:'one',state:'applied',age_ms:10}]);
    manager.sync([]);await vi.advanceTimersByTimeAsync(1);
    expect(deps.applied).toHaveBeenCalledWith('clip',expect.objectContaining({state:'applied'}),true);
    expect(manager.owns(entry.id)).toBe(false);
  });

  it('does not cancel a newer launch when an obsolete enqueue rejects late',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();let reject!:(error:Error)=>void;
    deps.submit.mockImplementationOnce(()=>new Promise<void>((_,r)=>{reject=r;}));
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(1);
    manager.sync([{id:'two',signature:'second',value:'new clip'}]);await vi.advanceTimersByTimeAsync(1);
    reject(new Error('stale revision'));await vi.advanceTimersByTimeAsync(1);
    expect(deps.cancel).toHaveBeenCalledOnce();expect(manager.owns('two')).toBe(true);
    manager.sync([]);await vi.advanceTimersByTimeAsync(1);
  });
  it('retries uncertain cancellation with the same revision fence',async()=>{
    vi.useFakeTimers();const {manager,deps,entry}=setup();
    deps.cancel.mockRejectedValueOnce(new Error('connection interrupted'));
    manager.sync([entry]);await vi.advanceTimersByTimeAsync(1);manager.sync([]);
    await vi.advanceTimersByTimeAsync(50);expect(manager.owns('one')).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(deps.cancel).toHaveBeenCalledTimes(2);
    expect(deps.cancel.mock.calls[0][1]).toBe(deps.cancel.mock.calls[1][1]);
    expect(manager.owns('one')).toBe(false);
  });

  it('keeps ownership and delays cleanup when cancellation wins before preparation finishes',async()=>{
    vi.useFakeTimers();const ready=deferred<{}>();const {manager,deps,entry}=setup(vi.fn(()=>ready.promise));
    manager.sync([entry]);manager.sync([]);await vi.advanceTimersByTimeAsync(50);
    expect(manager.owns('one')).toBe(true);expect(deps.release).not.toHaveBeenCalled();
    expect(deps.cancel).toHaveBeenCalledOnce();
    ready.resolve({});await vi.advanceTimersByTimeAsync(1);
    expect(manager.owns('one')).toBe(false);expect(deps.release).toHaveBeenCalledOnce();
    expect(deps.submit).not.toHaveBeenCalled();
  });
  it('waits for an obsolete overlapping preparation before starting its replacement',async()=>{
    vi.useFakeTimers();const ready=deferred<{}>();const {manager,deps,entry}=setup();
    deps.prepare.mockImplementationOnce(()=>ready.promise);
    manager.sync([entry]);manager.sync([{id:'two',signature:'next',value:'next'}]);
    await vi.advanceTimersByTimeAsync(50);
    expect(deps.prepare).toHaveBeenCalledTimes(1);expect(deps.submit).not.toHaveBeenCalled();
    expect((deps.prepare.mock.calls[0] as unknown as [string,()=>boolean])[1]()).toBe(false);
    ready.resolve({});await vi.advanceTimersByTimeAsync(1);
    expect(deps.prepare).toHaveBeenCalledTimes(2);expect(deps.submit).toHaveBeenCalledOnce();
    expect(deps.submit).toHaveBeenCalledWith('next',expect.anything(),expect.any(Number));
    manager.sync([]);await vi.advanceTimersByTimeAsync(1);
  });
  it('prepares unrelated rows concurrently',async()=>{
    vi.useFakeTimers();const ready=deferred<{}>();const {manager,deps,entry}=setup();
    deps.resources.mockImplementation(value=>[value]);deps.prepare.mockImplementationOnce(()=>ready.promise);
    manager.sync([entry,{id:'two',signature:'next',value:'unrelated'}]);
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.prepare).toHaveBeenCalledTimes(2);expect(deps.submit).toHaveBeenCalledOnce();
    manager.sync([]);ready.resolve({});await vi.advanceTimersByTimeAsync(1);
  });

  it('skips superseded preparations during a rapid sequence of replacements',async()=>{
    vi.useFakeTimers();const ready=deferred<{}>();const {manager,deps,entry}=setup();
    deps.prepare.mockImplementationOnce(()=>ready.promise);
    manager.sync([entry]);
    manager.sync([{id:'two',signature:'middle',value:'middle'}]);
    manager.sync([{id:'three',signature:'last',value:'last'}]);
    await vi.advanceTimersByTimeAsync(50);
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    ready.resolve({});await vi.advanceTimersByTimeAsync(1);
    expect(deps.prepare.mock.calls.map(call=>call[0])).toEqual(['clip','last']);
    expect(deps.submit).toHaveBeenCalledOnce();
    expect(deps.release).toHaveBeenCalledTimes(2);
    expect(manager.owns('three')).toBe(true);
    manager.sync([]);await vi.advanceTimersByTimeAsync(1);
  });

});
