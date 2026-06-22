import { IPCMessage } from './types';

export class IpcValidator {
  public static isValidMessage(msg: any): msg is IPCMessage {
    if (!msg || typeof msg !== 'object') return false;
    
    const validTypes = [
      'INITIAL_GRAPH_LOAD',
      'INCREMENTAL_GRAPH_UPDATE',
      'ACTIVE_EDITOR_CHANGED',
      'UPDATE_DIAGNOSTICS',
      'WEBVIEW_READY',
      'REQUEST_NODE_METADATA',
      'NODE_METADATA_RESPONSE',
      'REQUEST_FULL_REFRESH',
      'REQUEST_QUIZ_DATA',
      'QUIZ_DATA_RESPONSE',
      'REQUEST_BLAST_RADIUS',
      'BLAST_RADIUS_RESPONSE',
      'DEBUG_LOG'
    ];

    if (!validTypes.includes(msg.type)) {
      console.warn(`[IpcValidator] Rejected invalid message type: ${msg.type}`);
      return false;
    }

    return true;
  }
}
