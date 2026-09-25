// Main-process recording pump: one frame slot per 1/fps of wall clock from
// `startedAt` (the REC press), whatever the encoder is doing.
//
// Captures go into a queue and a separate writer feeds the encoder. A cold
// ffmpeg launch plus VideoToolbox setup takes 0.3-3.5 s, during which the
// encoder reads nothing; the old pump restarted its timeline once the encoder
// was warm, so that whole warm-up was cut from the start of every recording. Here the
// queue holds it instead. Memory is bounded: when the queue would pass
// `maxQueuedBytes`, every other queued frame is merged into its neighbour
// (the span stays, the cadence halves) and later captures are spaced to
// match until the writer catches up.
const DEFAULT_MAX_QUEUED_BYTES = 512 * 1024 * 1024;

function createPacedFramePump({
  fps,
  startedAt,
  capture,
  write,
  maxQueuedBytes = DEFAULT_MAX_QUEUED_BYTES,
  now = Date.now,
}) {
  const slotMs = 1000 / fps;
  const queue = []; // { data, slots } in timeline order
  let queuedBytes = 0;
  let peakQueuedBytes = 0;
  let covered = 0; // slots queued or written so far
  let written = 0;
  let stride = 1;
  let running = true;
  let timer = null;
  let wake = null;
  let lastFrame = null;
  let firstWriteAt = 0;
  let error = null;

  const notify = () => { const w = wake; wake = null; w?.(); };

  // Halve the queue's cadence while keeping every slot it spans.
  function thin() {
    for (let i = 0; i + 1 < queue.length; i++) {
      queue[i].slots += queue[i + 1].slots;
      queuedBytes -= queue[i + 1].data.length;
      queue.splice(i + 1, 1);
    }
    stride *= 2;
  }

  function tick() {
    if (!running) return;
    const due = Math.max(0, Math.floor((now() - startedAt) / slotMs) + 1);
    if (due > covered) {
      const slots = due - covered;
      const last = queue[queue.length - 1];
      let frame = null;
      if (!last || last.slots >= stride) {
        try { frame = capture(); } catch { frame = null; }
      }
      if (frame) {
        while (queue.length >= 2 && queuedBytes + frame.length > maxQueuedBytes) thin();
        if (last && queue.length && queuedBytes + frame.length > maxQueuedBytes) frame = null;
      }
      if (frame) {
        queue.push({ data: frame, slots });
        queuedBytes += frame.length;
        peakQueuedBytes = Math.max(peakQueuedBytes, queuedBytes);
        lastFrame = frame;
      } else if (queue.length) {
        queue[queue.length - 1].slots += slots;
      } else if (lastFrame) {
        queue.push({ data: lastFrame, slots });
        queuedBytes += lastFrame.length;
      } else {
        // Nothing captured yet: the first real frame covers these slots.
        schedule();
        return;
      }
      covered = due;
      notify();
    }
    schedule();
  }

  function schedule() {
    if (!running) return;
    const wait = startedAt + covered * slotMs - now();
    timer = setTimeout(tick, Math.max(1, wait));
  }

  const writer = (async () => {
    for (;;) {
      if (!queue.length) {
        if (!running) return;
        await new Promise((resolve) => { wake = resolve; });
        continue;
      }
      const entry = queue.shift();
      queuedBytes -= entry.data.length;
      if (!queue.length) stride = 1;
      for (let k = 0; k < entry.slots; k++) {
        await write(entry.data);
        if (!firstWriteAt) firstWriteAt = now();
        written++;
      }
    }
  })().catch((err) => {
    error = err;
    running = false;
    clearTimeout(timer);
    queue.length = 0;
    queuedBytes = 0;
  });

  tick();

  return {
    get written() { return written; },
    get lastFrame() { return lastFrame; },
    get error() { return error; },
    status: () => ({ written, covered, queued: queue.length, queuedBytes, peakQueuedBytes, firstWriteAt, stride, error }),
    /** Close the timeline at the current instant and write everything queued. */
    async stop() {
      if (running) {
        clearTimeout(timer);
        tick();
        clearTimeout(timer);
        running = false;
      }
      notify();
      await writer;
      return { written, covered, error, peakQueuedBytes, firstWriteAt };
    },
  };
}

module.exports = { createPacedFramePump, DEFAULT_MAX_QUEUED_BYTES };
