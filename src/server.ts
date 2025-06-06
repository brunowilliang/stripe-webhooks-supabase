import type Stripe from 'stripe';
import { stripe } from './libs/stripe';
import { supabase } from './libs/supabase';


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

console.log('🚀 Stripe Webhook running');
