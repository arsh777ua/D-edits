import type http from 'node:http';

export const DEFAULT_BRIDGE_PORT: number;
export function startBridgeServer(port?: number): Promise<http.Server | null>;
