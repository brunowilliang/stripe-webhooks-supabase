import type Stripe from 'stripe';
import { stripe } from './libs/stripe';
import { supabase } from './libs/supabase';
import type { Database } from './libs/database.types';

type Professional = Database['public']['Tables']['professionals']['Row'];

// Database webhook payload type
interface DatabaseWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record?: Professional;
  old_record?: Professional;
}

Bun.serve({
  port: 3000,
  routes: {
    "/": {
      GET: async (req) => {
        return Response.json({
          message: '🚀 Stripe Webhook running',
        });
      },
    },
    "/webhooks/database": {
      POST: async (req) => {
        try {
          const payload = await req.json() as DatabaseWebhookPayload;
          console.log('📨 Database webhook received:', payload.type);

          // Check if it's a professional creation
          if (payload.type === 'INSERT' && payload.table === 'professionals' && payload.record) {
            const professional = payload.record;
            
            console.log('👨‍💼 New professional created:', professional.id);

            // Create Stripe customer
            const customer = await stripe.customers.create({
              name: professional.full_name,
              metadata: {
                supabase_id: professional.id,
                role: 'PROFESSIONAL'
              }
            });

            console.log('💳 Stripe customer created:', customer.id);

            // Update professional with stripe_customer_id
            const { error } = await supabase
              .from('professionals')
              .update({ stripe_customer_id: customer.id })
              .eq('id', professional.id);

            if (error) {
              console.error('❌ Failed to update stripe_customer_id:', error);
              return Response.json({ error: 'Failed to update professional' }, { status: 500 });
            }

            console.log('✅ Professional updated with Stripe customer ID');
            return Response.json({ 
              success: true, 
              stripe_customer_id: customer.id 
            });
          }

          return Response.json({ received: true });
        } catch (error) {
          console.error('💥 Database webhook error:', error);
          return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
        }
      },
    },
    "/stripe-webhook": {
      POST: async (req) => {
        try {
          const event = await req.json() as Stripe.Event;

            if (event.type === 'customer.created') {
              console.log('✅ Customer created:', event.data.object.id);
              
              return Response.json({ received: true });
            }

          return Response.json({ received: true, event_type: event.type });
        } catch (error) {
          console.error('💥 Webhook error:', error);
          return Response.json({ error: 'Webhook processing failed' }, { status: 400 });
        }
      },
    }
  }
});

console.log('🚀 Server running on port 3000');
