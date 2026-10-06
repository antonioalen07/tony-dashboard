export interface Comment { id: string; mediaId: string; text: string; at: string; userId?: string; username?: string }
export interface MatchAutomation { id: string; active: boolean; scope: 'media'|'next_publish'|'all'; media_id: string|null; starts_at: string; created_at: string; keywords: string[]; match_mode: string; fuzzy: boolean }
export function enqueueComment(db: {rpc(name: string, params: Record<string, unknown>): PromiseLike<{data: unknown; error: {message:string;code?:string}|null}>}, comment: Comment, automations: MatchAutomation[], accountId: string, source: 'poll'|'webhook'): Promise<void>;
export function checked<T>(result: {data: T; error: {message: string; code?: string}|null}): T;
export function windowOpen(lead: {last_inbound_at?: string|null; opted_out?: boolean}, now?: number): boolean;
export function messagePayload(recipient: Record<string,string>, step: {kind: string; text?: string; audio_url?: string}): object;
