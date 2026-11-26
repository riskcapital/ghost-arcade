/**
 * Which phone remote server the server tests drive. The tests are its
 * contract, so they run against both: the JS one (server/ws-server.js, the
 * default) and the Rust one (phone-server/, through server/phone-server-rust.js)
 * with GA_TEST_PHONE_SERVER=rust (npm run test:remote:rust).
 */
/** What both servers offer; setters may resolve once applied (the Rust one does). */
export interface PhoneServer {
  setPairingToken(token: string | null): void | Promise<void>;
  setDesktopCredential(value: string | null): void | Promise<void>;
  shutdownServer(options?: { force?: boolean }): void;
  listening: Promise<{ wsPort: number; httpPort: number }>;
}

export const PHONE_SERVER_UNDER_TEST = process.env.GA_TEST_PHONE_SERVER === 'rust' ? 'rust' : 'js';

export async function importPhoneServer(): Promise<PhoneServer> {
  if (PHONE_SERVER_UNDER_TEST === 'rust') {
    return import('../../../server/phone-server-rust.js');
  }
  return import('../../../server/ws-server.js');
}
