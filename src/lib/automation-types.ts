export interface Automation {
    id: string;
    name: string;
    active: boolean;
    scope: 'media' | 'next_publish' | 'all';
    media_id: string | null;
    publish_queue_id: string | null;
    keywords: string[];
    match_mode: 'contains' | 'exact';
    fuzzy: boolean;
    dm_text: string;
    dm_link_url: string | null;
    dm_link_label: string | null;
    reply_enabled: boolean;
    reply_texts: string[];
    once_per_user: boolean;
    tag_ids: string[];
    starts_at: string;
    created_at: string;
    updated_at: string;
    stats?: Record<string, number>;
    reel?: {
        title: string;
        cover_url: string | null;
    };
}
export interface Tag {
    id: string;
    name: string;
}
export interface Lead {
    id: string;
    display_name: string | null;
    starred: boolean;
    instagram_user_id: string;
    username: string | null;
    qualification: string;
    opted_out: boolean;
    notes: string;
    last_inbound_at: string | null;
    tags: Tag[];
}
export interface Step {
    kind: 'text' | 'audio';
    delay_minutes: number;
    text: string;
    audio_url: string;
}
export interface Sequence {
    id: string;
    name: string;
    active: boolean;
    auto_enroll: boolean;
    required_tag_ids: string[];
    qualified_only: boolean;
    stop_on_reply: boolean;
    steps: Step[];
}
export interface Activity {
    id: string;
    automation_id: string;
    commenter_username: string | null;
    comment_text: string;
    status: string;
    error: string | null;
    skip_reason: string | null;
    created_at: string;
}
export interface Followup {
    id: string;
    status: string;
    due_at: string;
    error: string | null;
    step: Step;
    enrollment_id: string;
}
