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
        // Get all inquiries (admin only)
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

        const { data: inquiries, error: inquiriesError } = await supabaseClient
          .from("contact_inquiries")
          .select("*")
          .order("created_at", { ascending: false });

        if (inquiriesError) throw inquiriesError;

        return new Response(JSON.stringify(inquiries), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      case "POST":
        // Submit new inquiry (public)
        const body = await req.json();
        const { name, email, phone, message } = body;

        if (!name || !email || !message) {
          throw new Error("Name, email, and message are required");
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          throw new Error("Invalid email format");
        }

        const { data: newInquiry, error: createError } = await supabaseClient
          .from("contact_inquiries")
          .insert({
            name,
            email,
            phone: phone || null,
            message,
            is_responded: false,
          })
          .select()
          .single();

        if (createError) throw createError;

        // TODO: Send notification email to admin
        // TODO: Send confirmation email to user

        return new Response(JSON.stringify({
          ...newInquiry,
          message: "Your inquiry has been submitted successfully. We will get back to you soon."
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });

      case "PUT":
        // Mark inquiry as responded (admin only)
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

        const inquiryId = searchParams.get("id");
        if (!inquiryId) {
          throw new Error("Inquiry ID is required");
        }

        const updateBody = await req.json();
        const { is_responded } = updateBody;

        const { data: updatedInquiry, error: updateError } = await supabaseClient
          .from("contact_inquiries")
          .update({
            is_responded: is_responded || true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inquiryId)
          .select()
          .single();

        if (updateError) throw updateError;

        return new Response(JSON.stringify(updatedInquiry), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        });
    }

  } catch (error) {
    console.error("Error in contact-inquiry function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});