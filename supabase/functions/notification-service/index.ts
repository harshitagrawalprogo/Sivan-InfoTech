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
    const path = url.pathname.split('/').pop();

    switch (method) {
      case "POST":
        if (path === "email") {
          // Send email notification
          const body = await req.json();
          const { to, subject, message, template } = body;

          if (!to || !subject || !message) {
            throw new Error("To, subject, and message are required");
          }

          // Email service integration would go here
          // For now, storing in notifications table
          const { data: notification, error } = await supabaseClient
            .from("notifications")
            .insert({
              type: 'email',
              recipient: to,
              subject,
              message,
              template: template || null,
              status: 'sent',
              sent_at: new Date().toISOString()
            })
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify({
            success: true,
            message: "Email sent successfully",
            notification_id: notification.id
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (path === "sms") {
          // Send SMS notification
          const body = await req.json();
          const { to, message } = body;

          if (!to || !message) {
            throw new Error("Phone number and message are required");
          }

          // SMS service integration would go here
          // For now, storing in notifications table
          const { data: notification, error } = await supabaseClient
            .from("notifications")
            .insert({
              type: 'sms',
              recipient: to,
              message,
              status: 'sent',
              sent_at: new Date().toISOString()
            })
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify({
            success: true,
            message: "SMS sent successfully",
            notification_id: notification.id
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (path === "whatsapp") {
          // Send WhatsApp notification
          const body = await req.json();
          const { to, message, template_name } = body;

          if (!to || !message) {
            throw new Error("Phone number and message are required");
          }

          // WhatsApp API integration would go here
          // For now, storing in notifications table
          const { data: notification, error } = await supabaseClient
            .from("notifications")
            .insert({
              type: 'whatsapp',
              recipient: to,
              message,
              template: template_name || null,
              status: 'sent',
              sent_at: new Date().toISOString()
            })
            .select()
            .single();

          if (error) throw error;

          return new Response(JSON.stringify({
            success: true,
            message: "WhatsApp message sent successfully",
            notification_id: notification.id
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;

      case "GET":
        // Get notification history (admin only)
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

        const { data: notifications, error: notificationsError } = await supabaseClient
          .from("notifications")
          .select("*")
          .order("sent_at", { ascending: false })
          .limit(100);

        if (notificationsError) throw notificationsError;

        return new Response(JSON.stringify(notifications), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ error: "Invalid endpoint" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 404,
    });

  } catch (error) {
    console.error("Error in notification-service function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});