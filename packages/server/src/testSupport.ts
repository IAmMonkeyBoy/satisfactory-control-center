import type { Server } from "node:http";

/**
 * The TCP port a test server bound to. `Server.address()` is typed as
 * `string | AddressInfo | null`; this narrows it to the numeric port for a
 * server listening on port 0, throwing if it isn't an IP socket.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */
export function boundPort(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server is not listening on a TCP port");
  }
  return address.port;
}
