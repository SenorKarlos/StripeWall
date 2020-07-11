var database, bot;
const axios = require('axios'); const ini = require('ini');
const moment = require('moment'); const fs = require('fs');
const config = ini.parse(fs.readFileSync('files/config.ini', 'utf-8'));
const stripe_js = require('stripe')(config.STRIPE.live_sk);
const stripe = {
  customer: {
//------------------------------------------------------------------------------
//  CREATE A CUSTOMER
//------------------------------------------------------------------------------
    create: function(user_name, user_id, user_email, token){
      return new Promise(function(resolve) {
        stripe_js.customers.create({
          description: user_name+' - '+user_id,
          email: user_email,
          source: token
        }, function(err, customer) {
          if(err){
            console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Customer.', err.message); return resolve(null);
          } else{
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.id+' has been Created.');
            database.runQuery('UPDATE oauth_users SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id])
            return resolve(customer);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  UPDATE A CUSTOMER
//------------------------------------------------------------------------------
    update: function(user_id, customer, token){
      return new Promise(function(resolve) {
        stripe_js.customers.update(
          customer.id,
          { source: token },
          function(err, customer) {
            if(err){
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Updating Customer.', err.message); return resolve('ERROR');
            } else{
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.id+' has been Updated.');
              database.runQuery('UPDATE oauth_users SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id]);
              return resolve(customer);
            }
        });
      });
    },
//------------------------------------------------------------------------------
//  FETCH A CUSTOMER
//------------------------------------------------------------------------------
    fetch: function(customer_id){
      return new Promise(function(resolve) {
        stripe_js.customers.retrieve(
          customer_id,
          function(err, customer) {
            if(err){
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Customer.', err.message); return resolve('ERROR');
            } else{ return resolve(customer); }
          });
      });
    },
//------------------------------------------------------------------------------
//  DELETE A CUSTOMER
//------------------------------------------------------------------------------
    delete: function(customer_id){
      return new Promise(function(resolve) {
        stripe_js.customers.del(
          customer_id,
          function(err, confirmation) {
            if(err){
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Deleting Customer.', err.message); return resolve('ERROR');
            } else{
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer_id+' has been Deleted.');
              return resolve(confirmation); }
          });
      });
    },
//------------------------------------------------------------------------------
//  LIST CUSTOMERS
//------------------------------------------------------------------------------
    list: async function(last){
      stripe_js.customers.list(
        {limit: 100, starting_after: last},
        async function(err, list) {
          if(err){ console.log(err.message); }
          else{
            await stripe.customer.parse(list.data);
            if(list.has_more != false){
              stripe.customer.list(list.data[list.data.length - 1].id);
            }
          }
      });
    },
//------------------------------------------------------------------------------
//  PARSE CUSTOMERS
//------------------------------------------------------------------------------
    parse: async function(parse){
      parse.forEach((customer,index) => {
        setTimeout(function() {
          if(customer.subscriptions.data[0] && (customer.subscriptions.data[0].plan.id == config.STRIPE.plan_id || customer.subscriptions.data[0].plan.id == config.STRIPE.secondary_plan_id)){
            let unix = moment().unix();
            database.db.query('SELECT * FROM oauth_users WHERE user_id = ? AND map_guild = ?', [customer.description.split(' - ')[1], config.guild_id], async function (err, record, fields) {
              if(err){ return console.error('['+bot.getTime('stamp')+'] [stripe.js]', err.message); }
              if(record[0]){
                if(record[0].stripe_id == 'Lifetime'){ return; }
                else{
                  database.runQuery('UPDATE oauth_users SET user_name = ?, stripe_id = ?, plan_id = ?, email = ?, last_updated = ? WHERE user_id = ? AND map_guild = ?',
                    [customer.description.split(' - ')[0], customer.id, customer.subscriptions.data[0].plan.id, customer.email, unix, customer.description.split(' - ')[1], config.guild_id]);
                }
              } else{
                database.runQuery('INSERT INTO oauth_users (user_name, user_id, map_name, map_guild, stripe_id, plan_id, email, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                  [customer.description.split(' - ')[0], customer.description.split(' - ')[1], config.map_name, config.guild_id, customer.id, customer.subscriptions.data[0].plan.id, customer.email, unix]);
                return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.description.split(' - ')[0]+' ('+customer.description.split(' - ')[1]+' | '+customer.id+') Inserted User into the User Database.');
              }
            });
          }
        }, 5000 * index);
      });
    }
  },
  subscription: {
//------------------------------------------------------------------------------
//  CREATE A SUSBCRIPTION
//------------------------------------------------------------------------------
    create: function(customer,user_id){
      return new Promise(function(resolve) {
        stripe_js.subscriptions.create({
          customer: customer.id, items: [ { plan: config.STRIPE.plan_id, }, ]
        }, function(err, subscription) {
          if(err){
            console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Subscription.', err.message);
            return resolve('ERROR');
          } else{
            database.runQuery('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [subscription.customer, subscription.plan.id, user_id, config.guild_id]);
            console.log('['+bot.getTime('stamp')+'] [stripe.js] A New Stripe Subscription has been Created.');
            return resolve(subscription);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  CANCEL A SUSBCRIPTION
//------------------------------------------------------------------------------
    cancel: function(member, subscription_id){
      return new Promise(function(resolve) {
        stripe_js.subscriptions.update(
          subscription_id,
          { cancel_at_period_end: true },
          function(err, confirmation) {
            if(err){
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Canceling Subscription.', err.message);
              return resolve(null);
            } else{
              if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Subscription Cancellation', '', config.stripe_log_channel); }
              console.log("["+bot.getTime("stamp")+"] [stripe.js] "+member.user.tag+"'s subscription has been set to cancel at current period end.");
              return resolve(confirmation);
            }
        });
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE WBHOOK FUNCTIONS
//------------------------------------------------------------------------------
  webhookParse: async function(webhook){
    if(config.test_mode){ console.log('['+config.map_name+']',webhook); }
    let customer = '', user = ''; member = '';
    switch(webhook.type){
//------------------------------------------------------------------------------
//   CHARGE REFUNDED WEBHOOK
//------------------------------------------------------------------------------
      case 'charge.refunded':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Refund webhook for '+member.user.tag+' ('+customer.id+').');
            if(config.stripe_log && webhook.data.object.amount_refunded){
              return bot.sendEmbed(member, '0000FF', 'Payment Refunded! 🏧', 'Amount: **$'+webhook.data.object.amount_refunded/100+'**', config.stripe_log_channel);
            } else{ return; }
        } return;
//------------------------------------------------------------------------------
//   CHARGE SUCCESSFUL WEBHOOK
//------------------------------------------------------------------------------
      case 'charge.succeeded':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Successful Charge webhook for '+member.user.tag+' ('+customer.id+').');
            bot.assignDonor(member.user.id);
            if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**', config.stripe_log_channel); }
            return database.runQuery('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, customer.subscriptions.data[0].plan.id, customer.description.split(' - ')[1], config.guild_id]); break;
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION DELETED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.deleted':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        if(!customer.description){ console.error("[No Customer Description]",customer)}
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case webhook.data.object.plan.id != config.STRIPE.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+customer.description.split(' - ')[0]+' ('+webhook.data.object.customer+').');
            bot.removeDonor(customer.description.split(' - ')[1]);
            stripe.customer.delete(webhook.data.object.customer);
            if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Subscription Deleted! ⚰', '', config.stripe_log_channel); }
            return database.runQuery('UPDATE oauth_users SET stripe_id = NULL, plan_id = NULL WHERE user_id = ? AND map_guild = ?', [customer.description.split(' - ')[1], config.guild_id]);
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION CREATED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.created':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case webhook.data.object.plan.id != config.STRIPE.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Created Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            bot.assignDonor(customer.description.split(' - ')[1]);
            if(config.donor_welcome == true){
              bot.channels.cache.get(config.donor_channel_id)
                .send(config.donor_welcome_content.replace('%usertag%','<@'+member.id+'>'))
                .catch(console.error);
            }
            if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'New Subscription Created! 📋', '', config.stripe_log_channel); }
            return database.runQuery('UPDATE oauth_users SET plan_id = ? WHERE user_id = ? AND map_guild = ?', [customer.subscriptions.data[0].plan.id, member.user.id, config.guild_id]); break;
        } return;
//------------------------------------------------------------------------------
//   CUSTOMER CARD UPDATE WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.updated':
        customer = await stripe.customer.fetch(webhook.data.object.id);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Customer Updated webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.previous_attributes.default_source){
              let assigned = bot.assignDonor(member.user.id);
              if(assigned){
                console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') a payment update confirmation.');
                return bot.sendDM(member,'Card Information Updated! ✔', 'Your card information for '+config.map_name+' has been successfully updated! Thank you!','00FF00');
              }
              if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Customer Card Updated ✏', '', config.stripe_log_channel); }
            } else{ return; }
        } return;
//------------------------------------------------------------------------------
//   PAYMENT FAILED WEBHOOK
//------------------------------------------------------------------------------
      case 'invoice.payment_failed':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Payment Failed webhook for '+member.user.tag+' ('+customer.id+').');
        bot.removeDonor(member.user.id);
        if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Payment Failed! ⛔', 'Attempt Count: **'+webhook.data.object.attempt_count+'** of **4**', config.stripe_log_channel); }
        return bot.sendDM(member,'Subscription Payment Failed! ⛔', 'Uh Oh! Your Donor Payment failed to '+config.map_name+'. Please visit '+config.map_url+'/subscribe to update your payment information.','FF0000');
      default: return;
    } return;
  }
}
// EXPORT OBJECT
module.exports = stripe;
// SCRIPT REQUIREMENTS
database = require(__dirname + '/database.js');
bot = require(__dirname + '/bot.js');
