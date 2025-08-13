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
    const path = url.pathname.split('/').pop();

    switch (method) {
      case "GET":
        if (path === "profile") {
          // Get user profile
          const { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .eq("user_id", user.id)
            .single();

          if (error) throw error;
          
          return new Response(JSON.stringify(profile), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;

      case "PUT":
        if (path === "profile") {
          // Update user profile
          const body = await req.json();
          const { name, phone } = body;

          const { data: profile, error } = await supabaseClient
            .from("profiles")
            .update({ name, phone, updated_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify(profile), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;

      case "POST":
        if (path === "change-password") {
          // Change password
          const body = await req.json();
          const { newPassword } = body;

          const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
          });

          if (error) throw error;

          return new Response(JSON.stringify({ message: "Password updated successfully" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;
    }

    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 404,
    });

  } catch (error) {
    console.error("Error in user-management function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});