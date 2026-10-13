// Builds the follow camera's track off the main thread (a year of GPS takes ~50–150 ms cold).
import {buildTrack, type Bins} from './camera.ts';

export type TrackRequest = {id: number; bins: Bins; t0: number; t1: number};

self.onmessage = (e: MessageEvent<TrackRequest>) => {
  const {id, bins, t0, t1} = e.data;
  const track = buildTrack(bins, t0, t1);
  const transfer = track ? [track.x.buffer, track.y.buffer, track.lhx.buffer, track.lhy.buffer] : [];
  (self as unknown as Worker).postMessage({id, track}, transfer);
};
