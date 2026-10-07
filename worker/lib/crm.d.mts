type Rule = { id: string; active: boolean; keywords: string[]; match_mode: string; fuzzy: boolean; starts_at: string; created_at: string };
type Event = { sender?: { id: string }; recipient?: { id: string }; timestamp?: number; message?: { mid: string; text?: string; is_echo?: boolean; attachments?: { type?: string; payload?: { url?: string } }[]; reply_to?: { story?: { id?: string } } } };
type Inbound = { user: string; mid: string; text: string; at: string; attachments: unknown[]; storyId: string | null };
export function pickStoryAutomation(text: string, rules: Rule[], at: string): Rule | null;
export function inboundMessage(event: Event, account: string): Inbound | null;
export function receiveMessage(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }, message: Inbound, account: string, rules: Rule[]): Promise<void>;
