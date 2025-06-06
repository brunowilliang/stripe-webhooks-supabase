import type Stripe from 'stripe';
import { stripe } from './libs/stripe';
import { supabaseService } from './libs/supabase';
import type { Tables } from './libs/database.types';

type Professional = Tables<'professionals'>;

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
    "/webhooks/auth": {
      POST: async (req) => {
        try {
          const payload = await req.json() as DatabaseWebhookPayload;
          console.log('📨 Auth webhook received:', payload.type);

          // Only handle professionals table
          if (payload.table !== 'professionals') {
            return Response.json({ received: true });
          }

          switch (payload.type) {
            case 'INSERT': {
              if (!payload.record) break;
              
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
              const { error } = await supabaseService
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

            case 'UPDATE': {
              if (!payload.record || !payload.old_record) break;
              
              const updatedProfessional = payload.record;
              const oldProfessional = payload.old_record;
              
              console.log('🔄 Professional updated:', updatedProfessional.id);

              // Check if stripe_customer_id exists
              if (!updatedProfessional.stripe_customer_id) {
                console.log('⚠️ No Stripe customer ID found, skipping sync');
                return Response.json({ received: true });
              }

              // Check if name changed
              if (updatedProfessional.full_name !== oldProfessional.full_name) {
                console.log('📝 Name changed, updating Stripe customer');
                
                // Update Stripe customer
                await stripe.customers.update(updatedProfessional.stripe_customer_id, {
                  name: updatedProfessional.full_name
                });

                console.log('✅ Stripe customer updated with new name');
              }

              return Response.json({ 
                success: true, 
                synced: true 
              });
            }

            case 'DELETE': {
              if (!payload.old_record) break;
              
              const deletedProfessional = payload.old_record;
              console.log('🗑️ Professional deleted:', deletedProfessional.id);

              // Check if stripe_customer_id exists
              if (!deletedProfessional.stripe_customer_id) {
                console.log('⚠️ No Stripe customer ID found, skipping deletion');
                return Response.json({ received: true });
              }

              try {
                // Delete Stripe customer
                await stripe.customers.del(deletedProfessional.stripe_customer_id);
                console.log('✅ Stripe customer deleted:', deletedProfessional.stripe_customer_id);
                
                return Response.json({ 
                  success: true, 
                  deleted: true,
                  stripe_customer_id: deletedProfessional.stripe_customer_id
                });
              } catch (stripeError) {
                console.error('❌ Failed to delete Stripe customer:', stripeError);
                // Don't fail the entire webhook if Stripe deletion fails
                return Response.json({ 
                  warning: 'Professional deleted but Stripe customer deletion failed',
                  stripe_customer_id: deletedProfessional.stripe_customer_id
                });
              }
            }

            default: {
              console.log('❓ Unknown event type:', payload.type);
              return Response.json({ received: true });
            }
          }

          return Response.json({ received: true });
        } catch (error) {
          console.error('💥 Auth webhook error:', error);
          return Response.json({ error: 'Webhook processing failed' }, { status: 500 });
        }
      },
    },
    "/webhooks/stripe": {
      POST: async (req) => {
        try {
          const event = await req.json() as Stripe.Event;
          console.log('🎣 Stripe webhook received:', event.type);

          switch (event.type) {
            case 'customer.subscription.created': {
              const subscription = event.data.object as Stripe.Subscription;
              const customerId = subscription.customer as string;
              
              console.log('📝 Subscription created for customer:', customerId);
              
              // Find professional by customer_id
              const { data: professional, error: fetchError } = await supabaseService
                .from('professionals')
                .select('id')
                .eq('stripe_customer_id', customerId)
                .single();

              if (fetchError || !professional) {
                console.error('❌ Professional not found for customer:', customerId);
                break;
              }
              
              const { error } = await supabaseService
                .from('professionals')
                .update({ stripe_subscription_id: subscription.id })
                .eq('id', professional.id);

              if (error) {
                console.error('❌ Failed to update subscription_id:', error);
              } else {
                console.log('✅ Professional updated with subscription_id:', subscription.id);
              }
              break;
            }

            case 'customer.subscription.updated': {
              const subscription = event.data.object as Stripe.Subscription;
              const customerId = subscription.customer as string;
              
              console.log('🔄 Subscription updated:', subscription.id, 'Status:', subscription.status);
              
              // Find professional by customer_id
              const { data: professional } = await supabaseService
                .from('professionals')
                .select('id')
                .eq('stripe_customer_id', customerId)
                .single();

              if (!professional) {
                console.error('❌ Professional not found for customer:', customerId);
                break;
              }
              
              // Handle status changes (active, canceled, etc.)
              if (subscription.status === 'canceled') {
                const { error } = await supabaseService
                  .from('professionals')
                  .update({ stripe_subscription_id: null })
                  .eq('id', professional.id);

                if (!error) {
                  console.log('✅ Subscription removed from professional (canceled)');
                }
              }
              break;
            }

            case 'customer.subscription.deleted': {
              const subscription = event.data.object as Stripe.Subscription;
              const customerId = subscription.customer as string;
              
              console.log('🗑️ Subscription deleted for customer:', customerId);
              
              // Find professional by customer_id
              const { data: professional } = await supabaseService
                .from('professionals')
                .select('id')
                .eq('stripe_customer_id', customerId)
                .single();

              if (!professional) {
                console.error('❌ Professional not found for customer:', customerId);
                break;
              }
              
              const { error } = await supabaseService
                .from('professionals')
                .update({ stripe_subscription_id: null })
                .eq('id', professional.id);

              if (!error) {
                console.log('✅ Subscription removed from professional (deleted)');
              }
              break;
            }

            case 'invoice.payment_succeeded': {
              const invoice = event.data.object as Stripe.Invoice;
              console.log('💰 Payment succeeded for customer:', invoice.customer);
              break;
            }

            case 'invoice.payment_failed': {
              const invoice = event.data.object as Stripe.Invoice;
              console.log('❌ Payment failed for customer:', invoice.customer);
              break;
            }

            default: {
              console.log('❓ Unhandled event type:', event.type);
              break;
            }
          }

          return Response.json({ received: true });
        } catch (error) {
          console.error('💥 Stripe webhook error:', error);
          return Response.json({ error: 'Webhook processing failed' }, { status: 400 });
        }
      },
    }
  }
});

console.log('🚀 Server running on port 3000');
