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
        if (searchParams.get("action") === "verify") {
          // Verify certificate by ID
          const certificateId = searchParams.get("id");
          if (!certificateId) {
            throw new Error("Certificate ID is required");
          }

          const { data: certificate, error: certError } = await supabaseClient
            .from("certificates")
            .select(`
              *,
              courses (
                id,
                title,
                description,
                duration
              ),
              profiles!certificates_student_id_fkey (
                name,
                phone
              )
            `)
            .eq("id", certificateId)
            .single();

          if (certError) throw new Error("Certificate not found");

          return new Response(JSON.stringify({
            valid: true,
            certificate,
            message: "Certificate is valid"
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          // Get user's certificates
          const { data: certificates, error: certsError } = await supabaseClient
            .from("certificates")
            .select(`
              *,
              courses (
                id,
                title,
                description,
                duration,
                image_url
              )
            `)
            .eq("student_id", user.id)
            .order("issued_at", { ascending: false });

          if (certsError) throw certsError;

          return new Response(JSON.stringify(certificates), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

      case "POST":
        // Generate certificate (admin only)
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();

        if (profile?.role !== "admin") {
          throw new Error("Unauthorized: Admin access required");
        }

        const body = await req.json();
        const { student_id, course_id } = body;

        if (!student_id || !course_id) {
          throw new Error("Student ID and Course ID are required");
        }

        // Check if certificate already exists
        const { data: existingCert } = await supabaseClient
          .from("certificates")
          .select("id")
          .eq("student_id", student_id)
          .eq("course_id", course_id)
          .single();

        if (existingCert) {
          throw new Error("Certificate already exists for this student and course");
        }

        // Get student and course details
        const { data: student, error: studentError } = await supabaseClient
          .from("profiles")
          .select("name, phone")
          .eq("user_id", student_id)
          .single();

        if (studentError) throw new Error("Student not found");

        const { data: course, error: courseError } = await supabaseClient
          .from("courses")
          .select("title, description, duration")
          .eq("id", course_id)
          .single();

        if (courseError) throw new Error("Course not found");

        // Generate certificate URL (placeholder - you can integrate with actual PDF generation)
        const certificateId = crypto.randomUUID();
        const certificateUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/certificates/${certificateId}.pdf`;

        // TODO: Integrate with PDF generation library or service
        // For now, we'll store the certificate record with a placeholder URL

        const { data: newCertificate, error: createError } = await supabaseClient
          .from("certificates")
          .insert({
            id: certificateId,
            student_id,
            course_id,
            certificate_url: certificateUrl,
          })
          .select(`
            *,
            courses (
              id,
              title,
              description,
              duration
            ),
            profiles!certificates_student_id_fkey (
              name,
              phone
            )
          `)
          .single();

        if (createError) throw createError;

        return new Response(JSON.stringify(newCertificate), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 201,
        });

      default:
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 405,
        });
    }

  } catch (error) {
    console.error("Error in certificate-generator function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});