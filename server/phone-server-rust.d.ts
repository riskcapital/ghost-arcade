/** Swap in a new pairing token, closing every connection made with the old one. Resolves once applied. */
export function setPairingToken(token: string | null): Promise<void>;

/** Private loopback credential for the desktop host; never part of the QR. Resolves once applied. */
export function setDesktopCredential(value: string | null): Promise<void>;

export function shutdownServer(options?: { force?: boolean }): void;

/** Resolves with the bound ports once both servers are listening. */
export const listening: Promise<{ wsPort: number; httpPort: number }>;

/** Settles with the exit code when the server process goes away. */
export const exited: Promise<number | null>;

/** Where the server binary is, or null. */
export function findPhoneServerBinary(env?: NodeJS.ProcessEnv): string | null;
