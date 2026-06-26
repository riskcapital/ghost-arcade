import { WebPlugin } from '@capacitor/core';

export class GhostOscWeb extends WebPlugin {
  async start() {
    throw this.unavailable('Native OSC requires the Ghost Arcade iOS or Android app.');
  }

  async stop() {
    return { listening: false, port: 0 };
  }

  async status() {
    return { listening: false, port: 0 };
  }
}
