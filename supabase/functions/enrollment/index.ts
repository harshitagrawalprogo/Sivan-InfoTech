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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    
    const user = userData.user;
    if (!user) throw new Error("User not authenticated");

    const { method } = req;
    const url = new URL(req.url);
    const searchParams = url.searchParams;

    switch (method) {
      case "GET":
        // Get user's applications
        const { data: applications, error: appsError } = await supabaseClient
          .from("applications")
          .select(`
            *,
            courses (
              id,
              title,
              description,
              duration,
              price,
              image_url
            ),
            batches (
              id,
              batch_name,
              start_date,
              end_date,
              instructor,
              schedule_time,
              max_students,
              current_students
            )
          `)
          .eq("student_id", user.id)
          .order("applied_at", { ascending: false });

        if (appsError) throw appsError;

        return new Response(JSON.stringify(applications), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      case "POST":
        // Apply for course/batch
        const body = await req.json();
        const { course_id, batch_id } = body;

        if (!course_id) {
          throw new Error("Course ID is required");
        }

        // Check if user already applied for this course
        const { data: existingApp } = await supabaseClient
          .from("applications")
          .select("id")
          .eq("student_id", user.id)
          .eq("course_id", course_id)
          .single();

        if (existingApp) {
          throw new Error("You have already applied for this course");
        }

        // Check if batch exists and has capacity
        if (batch_id) {
          const { data: batch, error: batchError } = await supabaseClient
            .from("batches")
            .select("max_students, current_students")
            .eq("id", batch_id)
            .single();

          if (batchError) throw new Error("Batch not found");
          
          if (batch.current_students >= batch.max_students) {
            throw new Error("Batch is full");
          }
        }

        // Create application
        const { data: newApplication, error: createError } = await supabaseClient
          .from("applications")
          .insert({
            student_id: user.id,
            course_id,
            batch_id: batch_id || null,
            status: "pending",
          })
          .select(`
            *,
            courses (
              id,
              title,
              description,
              duration,
              price,
              image_url
            ),
            batches (
              id,
              batch_name,
              start_date,
              end_date,
              instructor,
              schedule_time
            )
          `)
          .single();

        if (createError) throw createError;

        return new Response(JSON.stringify(newApplication), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });

      case "PUT":
        // Update application status (admin only)
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (profile?.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }

        const applicationId = searchParams.get("id");
        if (!applicationId) {
          throw new Error("Application ID is required");
        }

        const updateBody = await req.json();
        const { status } = updateBody;

        if (!["pending", "approved", "rejected"].includes(status)) {
          throw new Error("Invalid status");
        }

        const { data: updatedApp, error: updateError } = await supabaseClient
          .from("applications")
          .update({
            status,
            updated_at: new Date().toISOString(),
          })
          .eq("id", applicationId)
          .select(`
            *,
            courses (
              id,
              title,
              description,
              duration,
              price
            ),
            batches (
              id,
              batch_name,
              start_date,
              end_date,
              instructor
            )
          `)
          .single();

        if (updateError) throw updateError;

        // If approved and batch_id exists, increment current_students
        if (status === "approved" && updatedApp.batch_id) {
          await supabaseClient
            .from("batches")
            .update({
              current_students: supabaseClient.raw("current_students + 1")
            })
            .eq("id", updatedApp.batch_id);
        }

        return new Response(JSON.stringify(updatedApp), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        });
    }

  } catch (error) {
    console.error("Error in enrollment function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});