import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabase';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const igAccountId = process.env.META_IG_ACCOUNT_ID || '17841476480622974'; // Fallback a tu ID

    if (!token) {
      return NextResponse.json({ error: 'Meta Access Token no configurado' }, { status: 500 });
    }

    console.log(`Starting Meta API sync for IG Account: ${igAccountId}...`);
    
    // 1. Fetch Media List (Reels)
    // Nota: Meta Graph API no expone "shortcode"; usamos "permalink" (la URL pública
    // del reel) que además necesitamos para transcribir el video luego vía Apify.
    const mediaUrl = `https://graph.facebook.com/v20.0/${igAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count,permalink&limit=20&access_token=${token}`;
    const mediaRes = await fetch(mediaUrl);
    const mediaData = await mediaRes.json();

    if (mediaData.error) {
      console.error('Meta API Error:', mediaData.error);
      throw new Error(mediaData.error.message);
    }

    const items = mediaData.data || [];
    const newReels = [];

    // 2. Loop through media and fetch insights
    for (const item of items) {
      if (item.media_type === 'VIDEO') { // Only process Reels/Videos
        
        // Default values
        let reach = 0, saves = 0, shares = 0, views = 0;
        
        try {
          // Fetch Insights for this specific Reel
          const insightsUrl = `https://graph.facebook.com/v20.0/${item.id}/insights?metric=reach,saved,shares,total_interactions&access_token=${token}`;
          const insightsRes = await fetch(insightsUrl);
          const insightsData = await insightsRes.json();

          if (!insightsData.error && insightsData.data) {
             const getMetric = (name: string) => {
                const metric = insightsData.data.find((m: any) => m.name === name);
                return metric && metric.values.length > 0 ? metric.values[0].value : 0;
             };
             reach = getMetric('reach');
             saves = getMetric('saved');
             shares = getMetric('shares');
          }
        } catch (e) {
          console.warn(`Could not fetch insights for ${item.id}`, e);
        }

        // Calculate Engagement Rate (Likes + Comments + Saves + Shares) / Reach * 100
        let engagementRate = null;
        if (reach > 0) {
          const totalInteractions = (item.like_count || 0) + (item.comments_count || 0) + saves + shares;
          engagementRate = parseFloat(((totalInteractions / reach) * 100).toFixed(2));
        }

        const reelData = {
          instagram_id: item.id,
          title: item.caption || '',
          cover_url: item.thumbnail_url || item.media_url || '',
          video_url: item.permalink || '',
          published_at: item.timestamp,
          views: views || reach, // fallback to reach if plays is unsupported
          likes: item.like_count || 0,
          comments: item.comments_count || 0,
          reach: reach,
          saves: saves,
          shares: shares,
          engagement_rate: engagementRate
        };

        // Upsert en Supabase
        const { data, error } = await supabase
          .from('reels')
          .upsert(reelData, { onConflict: 'instagram_id' })
          .select()
          .single();

        if (error) {
          console.error('Error inserting to Supabase:', error);
        } else {
          newReels.push(data);
        }
      }
    }

    return NextResponse.json({ success: true, syncedCount: newReels.length, data: newReels });
  } catch (error: any) {
    console.error('Sync Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
