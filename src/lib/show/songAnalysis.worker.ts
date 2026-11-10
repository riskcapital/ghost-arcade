/** Song analysis off the main thread (see songAnalysisClient.ts). */
import { createSongAnalysisJob, type SongAnalysisReply, type SongAnalysisRequest } from './songAnalysisProtocol';

const scope = self as unknown as {
  postMessage(message: SongAnalysisReply): void;
  onmessage: ((event: MessageEvent<SongAnalysisRequest>) => void) | null;
};
const job = createSongAnalysisJob((message) => scope.postMessage(message));
scope.onmessage = (event) => job(event.data);
