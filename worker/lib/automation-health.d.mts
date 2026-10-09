type CheckError = { check: string; code: string | number | null; message: string };
type DatabaseStatus = 'available' | 'migration_required' | 'unverified';
export interface AutomationHealth {
  checkedAt: string;
  status: 'ready' | 'needs_configuration' | 'migration_required' | 'unverified';
  configuration: { accessToken: boolean; appId: boolean; appSecret: boolean; verifyToken: boolean; pageId: boolean; instagramAccountId: boolean };
  meta: {
    status: 'connected' | 'disconnected' | 'unverified';
    appSubscribed: boolean | null; pageSubscribed: boolean | null;
    commentsSubscribed: boolean | null; messagesSubscribed: boolean | null;
    callbackMatches: boolean | null; pageSubscribedFields: string[]; errors: CheckError[];
  };
  database: {
    automations: DatabaseStatus; inbox: DatabaseStatus;
    lastCommentEventAt: string | null; lastInboundMessageAt: string | null;
    commentsRecorded: number | null; inboundMessagesRecorded: number | null; errors: CheckError[];
  };
  worker: { status: 'unknown'; detail: string };
}
export function getAutomationHealth(
  env: Record<string, string | undefined>,
  // Server and worker may install distinct Postgrest versions. Keep their
  // nominal query-builder types out of this shared diagnostic boundary.
  db: { from(table: string): unknown },
  options?: {
    fetcher?: typeof fetch;
    meta?: { pageGet(path: string): Promise<unknown> };
    expectedCallbackUrl?: string;
    now?: () => number;
  },
): Promise<AutomationHealth>;
