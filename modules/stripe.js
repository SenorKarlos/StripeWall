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
            console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Customer.', err.message); return resolve('ERROR');
          } else{
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.id+' has been Created.');
            database.runQuery('UPDATE oauth_users SET stripe_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, user_id, config.guild_id]);
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
      console.info("[stripe.js] Starting user check.")
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
          } else if (subscription.status == 'incomplete') {
            database.runQuery('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [subscription.customer, subscription.plan.id, user_id, config.guild_id]);
            console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Charging Subscription, but record created.');
            return resolve('INCOMPLETE');
          } else{
            database.runQuery('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [subscription.customer, subscription.plan.id, user_id, config.guild_id]);
            console.log('['+bot.getTime('stamp')+'] [stripe.js] A New Stripe Subscription has been Created.');
            return resolve(subscription);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  PAY OUTSTANDING INVOICE
//------------------------------------------------------------------------------
    pay: function(member,invoice_id){
      return new Promise(function(resolve) {
        stripe_js.invoices.pay(
          invoice_id,
          function(err, invoice) {
            if(err){
              if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Invoice Payment Attempt Failed', '', config.stripe_log_channel); }
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Paying Subscription Invoice.', err.message);
              return resolve('ERROR');
            } else if (invoice.paid == false) {
              if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Invoice Payment Attempt Failed', '', config.stripe_log_channel); }
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Paying Subscription Invoice.');
              return resolve('ERROR');
            } else if (invoice.paid == true) {
              if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Failed Subscription Invoice Paid', '', config.stripe_log_channel); }
              console.log("["+bot.getTime("stamp")+"] [stripe.js] "+member.user.tag+"'s subscription payment was successful.");
              return resolve('PAID');
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
              bot.sendDM(member,'Subscription Cancellation', 'Your subscription has been set to cancel at current period end.','FFFF00');
              console.log("["+bot.getTime("stamp")+"] [stripe.js] "+member.user.tag+"'s subscription has been set to cancel at current period end.");
              return resolve(confirmation);
            }
        });
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE WEBHOOK FUNCTIONS
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
            bot.sendDM(member,'Payment Refunded! 🏧', 'Amount: **$'+webhook.data.object.amount_refunded/100+'**, Access Revoked, Update Payment Information if Continuing','0000FF');
            bot.removeDonor(customer.description.split(' - ')[1]);
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
            bot.sendDM(member,'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**','00FF00');
            bot.assignDonor(member.user.id);
            if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**', config.stripe_log_channel); }
            return database.runQuery('UPDATE oauth_users SET stripe_id = ?, plan_id = ? WHERE user_id = ? AND map_guild = ?', [customer.id, customer.subscriptions.data[0].plan.id, customer.description.split(' - ')[1], config.guild_id]);
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION DELETED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.deleted':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        if(!customer.description){ console.error("[No Customer Description]",customer); }
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case webhook.data.object.plan.id != config.STRIPE.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+customer.description.split(' - ')[0]+' ('+webhook.data.object.customer+').');
            bot.sendDM(member,'Subscription Record Deleted! ⚰', 'Access Revoked, Please Start Over if Continuing','FF0000');
            bot.removeDonor(customer.description.split(' - ')[1]);
            if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Subscription Record Deleted! ⚰', '', config.stripe_log_channel); }
            return database.runQuery('UPDATE oauth_users SET plan_id = NULL WHERE user_id = ? AND map_guild = ?', [customer.description.split(' - ')[1], config.guild_id]);
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
            if(webhook.data.object.status == "active"){
              bot.assignDonor(customer.description.split(' - ')[1]);
              if(config.donor_welcome == true){
                bot.channels.cache.get(config.donor_channel_id)
                  .send(config.donor_welcome_content.replace('%usertag%','<@'+member.id+'>'))
                  .catch(console.error);
              }
              if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'New Subscription Sucessfully Created! 📋', '', config.stripe_log_channel); }
            } else {
              if(config.stripe_log){ bot.sendEmbed(member, 'FFFF00', 'New Subscription Partially Created ⚠️', '', config.stripe_log_channel); }
              return database.runQuery('UPDATE oauth_users SET plan_id = ? WHERE user_id = ? AND map_guild = ?', [customer.subscriptions.data[0].plan.id, member.user.id, config.guild_id]);
            } return;
          } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION UPDATED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.updated':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case webhook.data.object.plan.id != config.STRIPE.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Updated Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.object.status == "active" && webhook.data.previous_attributes.status == "incomplete"){
              bot.assignDonor(customer.description.split(' - ')[1]);
              if(config.donor_welcome == true){
                bot.channels.cache.get(config.donor_channel_id)
                  .send(config.donor_welcome_content.replace('%usertag%','<@'+member.id+'>'))
                  .catch(console.error);
              }
              if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Subscription Sucessfully Updated! 📋', '', config.stripe_log_channel); }
              return database.runQuery('UPDATE oauth_users SET plan_id = ? WHERE user_id = ? AND map_guild = ?', [customer.subscriptions.data[0].plan.id, member.user.id, config.guild_id]);
            } else { return;
            } return;
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
            if(!webhook.data.previous_attributes.default_source){
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Creation/Other Webhook, Ignoring');
              return;
            } else { 
              if(webhook.data.object.subscriptions.data[0].status == "incomplete" || webhook.data.object.subscriptions.data[0].status == "past_due" || webhook.data.object.subscriptions.data[0].status == "unpaid"){
                bot.sendDM(member,'Card Information Updated! ✔', 'Your card information for '+config.map_name+' has been successfully updated! Retrying Payment.','00FF00');
                invoice_id = webhook.data.object.subscriptions.data[0].latest_invoice;
                retry = await stripe.subscription.pay(member, invoice_id);
                if(retry == 'ERROR'){
                  bot.sendDM(member,'Retry Failed! ⛔', 'Your card update did not result in a successful retry. Please try again.','FF0000');
                  console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') a payment failed update confirmation.');
                  if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Customer Card Update Incomplete (Initial Setup/Refunded) ✏', '', config.stripe_log_channel); }
                  return;
                } else if(retry == 'PAID'){
                  bot.assignDonor(customer.description.split(' - ')[1]);
                  bot.sendDM(member,'Retry Success! ✔', 'Your card update resulted in successful payment. You should now have access!','00FF00');
                  console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') a successful payment confirmation.');
                  if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Customer Card Update Complete (Initial Setup/Refunded) ✏', '', config.stripe_log_channel); }
                  return;
                }
              } else {
                bot.sendDM(member,'Card Information Updated! ✔', 'Your card information for '+config.map_name+' has been successfully updated!','00FF00');
                console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') an update notification.');
                if(config.stripe_log){ bot.sendEmbed(member, '00FF00', 'Customer Card Updated ✏', '', config.stripe_log_channel); }
                return;
              }
            }
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
        if(webhook.data.object.billing_reason == 'subscription_create') {
          if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Subscription Creation Payment Failed! ⛔', 'Only Attempt', config.stripe_log_channel); }
          return;
        }
        if(config.stripe_log){ bot.sendEmbed(member, 'FF0000', 'Payment Failed! ⛔', 'Only Attempt', config.stripe_log_channel); }
        return bot.sendDM(member,'Subscription Payment Failed! ⛔', 'Uh Oh! Your Payment failed to '+config.map_name+'. Please visit '+config.map_url+'/subscribe to Update your payment information.','FF0000');
      default: return;
    } return;
  }
};
// EXPORT OBJECT
module.exports = stripe;
// SCRIPT REQUIREMENTS
database = require(__dirname + '/database.js');
bot = require(__dirname + '/bot.js');
