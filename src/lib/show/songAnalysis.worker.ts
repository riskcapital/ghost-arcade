/** Song analysis off the main thread (see songAnalysisClient.ts). */
import { createSongAnalysisJob, type SongAnalysisReply, type SongAnalysisRequest } from './songAnalysisProtocol';

const scope = self as unknown as {
  postMessage(message: SongAnalysisReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SongAnalysisRequest>) => void) | null;
};
const job = createSongAnalysisJob((message, transfer) => scope.postMessage(message, transfer ?? []));
scope.onmessage = (event) => job(event.data);
