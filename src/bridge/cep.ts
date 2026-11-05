// CEP backend: HTTP to the ae-compose CEP extension on 127.0.0.1 (token in ~/.ae-compose/bridge.json).
// The client itself is the shared core's HttpBridge.
import os from 'node:os';
import path from 'node:path';
import { HttpBridge } from '@ae-mcp/core/bridge/http.ts';

export const BRIDGE_INFO = path.join(os.homedir(), '.ae-compose', 'bridge.json');

export class CepBackend extends HttpBridge {
  declare readonly name: 'cep';
  constructor() {
    super({ name: 'cep', infoFile: BRIDGE_INFO, missingHint: 'is After Effects running with the ae-compose extension?' });
  }
}
