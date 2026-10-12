/** Swap in a new pairing token, closing every connection made with the old one. */
export function setPairingToken(token: string | null): void;

/** Private loopback credential for the desktop host; never part of the QR. */
export function setDesktopCredential(value: string | null): void;

export function shutdownServer(options?: { force?: boolean }): void;

/** Resolves with the bound ports once both servers are listening. */
export const listening: Promise<{ wsPort: number; httpPort: number }>;
