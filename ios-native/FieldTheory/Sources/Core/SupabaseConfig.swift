import Foundation
import Supabase

/// Same Supabase project as mac-app/.env.local. The key is the publishable
/// (anon) key — safe to embed; RLS enforces access.
enum SupabaseConfig {
    static let url = URL(string: "https://cighxaroptskntwbrctl.supabase.co")!
    static let publishableKey = "sb_publishable_j-f9Y3EU1YrD4K3Dglz0Ag_rrVgKzcM"

    static func makeClient() -> SupabaseClient {
        SupabaseClient(supabaseURL: url, supabaseKey: publishableKey)
    }
}
