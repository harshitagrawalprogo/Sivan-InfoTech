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
        if (path === "initiate") {
          // Initiate PhonePe payment
          const authHeader = req.headers.get("Authorization");
          if (!authHeader) {
            throw new Error("No authorization header provided");
          }

          const token = authHeader.replace("Bearer ", "");
          const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
          if (userError) throw new Error(`Authentication error: ${userError.message}`);
          
          const user = userData.user;
          if (!user) throw new Error("User not authenticated");

          const body = await req.json();
          const { amount, course_id, batch_id } = body;

          if (!amount || !course_id) {
            throw new Error("Amount and course_id are required");
          }

          // Create payment record
          const paymentData = {
            user_id: user.id,
            course_id,
            batch_id: batch_id || null,
            amount: parseFloat(amount),
            status: 'pending',
            payment_method: 'phonepe',
            transaction_id: `TXN_${Date.now()}_${user.id.substring(0, 8)}`,
          };

          const { data: payment, error: paymentError } = await supabaseClient
            .from("payments")
            .insert(paymentData)
            .select()
            .single();

          if (paymentError) throw paymentError;

          // PhonePe integration would go here
          // For now, returning mock response
          const phonepeResponse = {
            success: true,
            code: "PAYMENT_INITIATED",
            message: "Payment initiated successfully",
            data: {
              merchantId: Deno.env.get("PHONEPE_MERCHANT_ID"),
              merchantTransactionId: payment.transaction_id,
              instrumentResponse: {
                redirectInfo: {
                  url: `${req.headers.get("origin")}/payment-status?txn=${payment.transaction_id}`,
                  method: "GET"
                }
              }
            }
          };

          return new Response(JSON.stringify(phonepeResponse), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
        
        if (path === "callback") {
          // Handle PhonePe callback
          const body = await req.json();
          const { merchantTransactionId, code, message } = body;

          if (!merchantTransactionId) {
            throw new Error("Transaction ID is required");
          }

          const status = code === "PAYMENT_SUCCESS" ? "completed" : "failed";

          const { data: updatedPayment, error: updateError } = await supabaseClient
            .from("payments")
            .update({ 
              status,
              updated_at: new Date().toISOString(),
              payment_response: body
            })
            .eq("transaction_id", merchantTransactionId)
            .select()
            .single();

          if (updateError) throw updateError;

          // If payment successful, create enrollment
          if (status === "completed") {
            const { error: enrollmentError } = await supabaseClient
              .from("enrollments")
              .insert({
                user_id: updatedPayment.user_id,
                course_id: updatedPayment.course_id,
                batch_id: updatedPayment.batch_id,
                enrollment_date: new Date().toISOString(),
                status: 'active'
              });

            if (enrollmentError) {
              console.error("Error creating enrollment:", enrollmentError);
            }
          }

          return new Response(JSON.stringify({
            success: true,
            payment: updatedPayment
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        break;

      case "GET":
        if (path === "status") {
          // Check payment status
          const transactionId = url.searchParams.get("txn");
          if (!transactionId) {
            throw new Error("Transaction ID is required");
          }

          const { data: payment, error } = await supabaseClient
            .from("payments")
            .select("*")
            .eq("transaction_id", transactionId)
            .single();

          if (error) throw error;

          return new Response(JSON.stringify(payment), {
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
    console.error("Error in payment-phonepe function:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});