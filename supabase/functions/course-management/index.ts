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
        // Get all active courses
        const { data: courses, error: coursesError } = await supabaseClient
          .from("courses")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (coursesError) throw coursesError;

        return new Response(JSON.stringify(courses), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      case "POST":
        // Admin only - Create new course
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
        const { title, description, duration, price, image_url } = body;

        const { data: newCourse, error: createError } = await supabaseClient
          .from("courses")
          .insert({
            title,
            description,
            duration,
            price,
            image_url,
            is_active: true,
          })
          .select()
          .single();

        if (createError) throw createError;

        return new Response(JSON.stringify(newCourse), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });

      case "PUT":
        // Admin only - Update course
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

        const courseId = searchParams.get("id");
        if (!courseId) {
          throw new Error("Course ID is required");
        }

        const updateBody = await req.json();
        const { title, description, duration, price, image_url, is_active } = updateBody;

        const { data: updatedCourse, error: updateError } = await supabaseClient
          .from("courses")
          .update({
            title,
            description,
            duration,
            price,
            image_url,
            is_active,
            updated_at: new Date().toISOString(),
          })
          .eq("id", courseId)
          .select()
          .single();

        if (updateError) throw updateError;

        return new Response(JSON.stringify(updatedCourse), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        });
    }

  } catch (error) {
    console.error("Error in course-management function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});