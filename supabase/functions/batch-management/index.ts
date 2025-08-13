import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { method } = req;
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    switch (method) {
      case "GET":
        // Get batches (filtered by course if provided)
        const courseId = searchParams.get("course_id");
        let query = supabaseClient
          .from("batches")
          .select(`
            *,
            courses(title, description, duration)
          `)
          .eq("is_active", true)
          .order("start_date", { ascending: true });

        if (courseId) {
          query = query.eq("course_id", courseId);
        }

        const { data: batches, error: batchesError } = await query;
        if (batchesError) throw batchesError;

        return new Response(JSON.stringify(batches), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      case "POST":
        // Admin only - Create new batch
        const authHeader = req.headers.get("Authorization");
        if (!authHeader) {
          throw new Error("No authorization header provided");
        }

        const token = authHeader.replace("Bearer ", "");
        const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
        if (userError) throw new Error(`Authentication error: ${userError.message}`);
        
        const user = userData.user;
        if (!user) throw new Error("User not authenticated");

        // Check if user is admin
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (profile?.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }

        const body = await req.json();
        const { course_id, batch_name, start_date, end_date, instructor, schedule_time, max_students } = body;

        if (!course_id || !batch_name || !start_date) {
          throw new Error("Course ID, batch name, and start date are required");
        }

        const { data: newBatch, error: createError } = await supabaseClient
          .from("batches")
          .insert({
            course_id,
            batch_name,
            start_date,
            end_date: end_date || null,
            instructor: instructor || null,
            schedule_time: schedule_time || null,
            max_students: max_students || 30,
            current_students: 0,
            is_active: true,
          })
          .select()
          .single();

        if (createError) throw createError;

        return new Response(JSON.stringify(newBatch), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });

      case "PUT":
        // Admin only - Update batch
        const updateAuthHeader = req.headers.get("Authorization");
        if (!updateAuthHeader) {
          throw new Error("No authorization header provided");
        }

        const updateToken = updateAuthHeader.replace("Bearer ", "");
        const { data: updateUserData, error: updateUserError } = await supabaseClient.auth.getUser(updateToken);
        if (updateUserError) throw new Error(`Authentication error: ${updateUserError.message}`);
        
        const updateUser = updateUserData.user;
        if (!updateUser) throw new Error("User not authenticated");

        // Check if user is admin
        const { data: updateProfile } = await supabaseClient
          .from("profiles")
          .select("role")
          .eq("user_id", updateUser.id)
          .single();

        if (updateProfile?.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }

        const batchId = searchParams.get("id");
        if (!batchId) {
          throw new Error("Batch ID is required");
        }

        const updateBody = await req.json();
        const { batch_name, start_date, end_date, instructor, schedule_time, max_students, is_active } = updateBody;

        const { data: updatedBatch, error: updateError } = await supabaseClient
          .from("batches")
          .update({
            batch_name,
            start_date,
            end_date,
            instructor,
            schedule_time,
            max_students,
            is_active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", batchId)
          .select()
          .single();

        if (updateError) throw updateError;

        return new Response(JSON.stringify(updatedBatch), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        });
    }

  } catch (error) {
    console.error("Error in batch-management function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});