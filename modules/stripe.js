var database, bot;
const axios = require('axios');
const moment = require('moment');
const config = require("../files/config.json");
const stripe_js = require('stripe')(config.stripe.live_sk);
const stripe = {
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER FUNCTIONS
//------------------------------------------------------------------------------
  customer: {
//------------------------------------------------------------------------------
//  CREATE A CUSTOMER
//------------------------------------------------------------------------------
    create: function(user_name, user_id, user_email) {
      return new Promise(function(resolve) {
        stripe_js.customers.create({
          name: user_name,
          description: user_id,
          email: user_email
        }, function(err, customer) {
          if(err) {
            console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Creating Customer.', err.message);
            return resolve('ERROR');
          } else {
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.id+' has been Created.');
            database.runQuery('UPDATE stripe_users SET stripe_id = ? WHERE user_id = ?', [customer.id, user_id]);
            return resolve(customer);
          }
        });
      });
    },
//------------------------------------------------------------------------------
//  UPDATE A CUSTOMER
//------------------------------------------------------------------------------
    update: function(customer_id, email, name) {
      return new Promise(function(resolve) {
        stripe_js.customers.update(
          customer_id,
          { email: email, name: name },
          function(err, customer) {
            if(err) {
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Updating Customer.', err.message);
              return resolve('ERROR');
            } else {
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer ' + name + ' (' + customer.id + ') has been Updated.');
              return resolve(customer);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  FETCH A CUSTOMER
//------------------------------------------------------------------------------
    fetch: function(customer_id) {
      return new Promise(function(resolve) {
        stripe_js.customers.retrieve(
          customer_id, { expand: ['subscriptions.data'], },
          function(err, customer) {
            if(err) {
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Fetching Customer.', err.message);
              return resolve('ERROR');
            } else {
              return resolve(customer);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  DELETE A CUSTOMER
//------------------------------------------------------------------------------
    delete: function(customer_id) {
      return new Promise(function(resolve) {
        stripe_js.customers.del(
          customer_id,
          function(err, confirmation) {
            if(err) {
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Deleting Customer.', err.message);
              return resolve('ERROR');
            } else {
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer_id+' has been Deleted.');
              return resolve(confirmation);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  LIST CUSTOMERS
//------------------------------------------------------------------------------
    list: async function(last) {
      stripe_js.customers.list(
        {limit: 100, expand: ['data.subscriptions'], starting_after: last},
        async function(err, list) {
          if(err) {
            console.log(err.message);
          } else {
            console.info("["+bot.getTime('stamp')+"] [stripe.js] Parsing "+list.data.length+" users.")
            await stripe.customer.parse(list.data);
            if(list.has_more == true) {
              stripe.customer.list(list.data[list.data.length - 1].id);
            } else {
              console.info("["+bot.getTime("stamp")+"] [stripe.js] Stripe Customer Synchronization Complete.");
            }
          }
        }
      );
    },
//------------------------------------------------------------------------------
//  PARSE CUSTOMERS
//------------------------------------------------------------------------------
    parse: async function(parse) {
      let unix = moment().unix();
      parse.forEach((customer,index) => {
console.log(customer);
        setTimeout(function() {
          if(customer.subscriptions.data[0]) {
console.log(customer.subscriptions.data[0]);
            for (let x = 0; x < customer.subscriptions.data.length; x++) {
              for (let i = 0; i < config.stripe.price_ids.length; i++) {
                if(customer.subscriptions.data[x].plan.id == config.stripe.price_ids[i].id) {
                  database.db.query('SELECT * FROM stripe_users WHERE user_id = ?', [customer.description], async function (err, record, fields) {
                    if(err) { return console.error('['+bot.getTime('stamp')+'] [stripe.js]'+customer.name+' '+customer.id, err.message); }
                    if(record[0]){
                      if(record[0].stripe_id == 'Manual') { return; } else {
                        if (customer.id != record[0].stripe_id || customer.subscriptions.data[x].plan.id != record[0].plan_id) {
                          database.runQuery('UPDATE stripe_users SET stripe_id = ?, plan_id = ?, last_updated = ? WHERE user_id = ?', [customer.id, customer.subscriptions.data[x].plan.id, unix, customer.description]);
                          return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Updated Stripe info in Database.'); 
                        } return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Verified Stripe info in Database.');
                      } // end if not Manual tracked user
                    } else { // end if in database
                      database.runQuery('INSERT INTO stripe_users (user_name, user_id, stripe_id, plan_id, email, last_updated) VALUES (?, ?, ?, ?, ?, ?)',
                        [customer.name, customer.description, customer.id, customer.subscriptions.data[x].plan.id, customer.email, unix]);
                      return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Inserted User into Database.');
                    } // end not in database
                  }); // dead end after database fetch
                } // dead end of customer plan vs config plan
              } // dead end for every plan in config
            } // dead end for each sub in customer array (usually 1)
          } else { //end customer has sub
            let unix = moment().unix();
            database.db.query('SELECT * FROM stripe_users WHERE user_id = ?', [customer.description], async function (err, record, fields) {
              if(err) { return console.error('['+bot.getTime('stamp')+'] [stripe.js]'+customer.name+' '+customer.id, err.message); }
              if(record[0]){
                let dbUpdated = false;
                if(record[0].stripe_id == 'Manual') { return; } else {
                  if (customer.id != record[0].stripe_id) {
                    database.runQuery('UPDATE stripe_users SET stripe_id = ?, last_updated = ? WHERE user_id = ?', [customer.id, unix, customer.description]);
                    dbUpdated = true;
                  }
                  if (record[0].plan_id != null) {
                    for (let i = 0; i < config.stripe.price_ids.length; i++) {
                      if (record[0].plan_id == config.stripe.price_ids[i].id) {
                        if (config.stripe.price_ids[i].mode == "subscription") {
                          database.runQuery('UPDATE stripe_users SET plan_id = null, last_updated = ? WHERE user_id = ?', [unix, customer.description]);
                          dbUpdated = true;
                      /*  } else { //end if mode is sub */
                          
                        } 
                      } // end if record plan matches config plan
                    } // dead end for each plan in config
                  } // end if db plan not null
                  if (dbUpdated == true) {
                    return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Updated Stripe info in Database.');
                  } else {
                    return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Verified Stripe info in Database.');
                  } // end if updated or verified
                } // end if not Manual tracked user
              } else { // end of in DB
                database.runQuery('INSERT INTO stripe_users (user_name, user_id, stripe_id, email, last_updated) VALUES (?, ?, ?, ?, ?)',
                  [customer.name, customer.description, customer.id, customer.email, unix]);
                return console.info('['+bot.getTime('stamp')+'] [stripe.js] '+customer.name+' ('+customer.description+' | '+customer.id+') Inserted User into Database.');
              } //end not in db
            }); // dead end after database fetch
          } // end of customer has no sub data
        }, 2500 * index);
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SUBSCRIPTION FUNCTIONS
//------------------------------------------------------------------------------
  subscription: {
//------------------------------------------------------------------------------
//  CANCEL A SUSBCRIPTION (USER-LEFT)
//------------------------------------------------------------------------------
    cancelNow: function(member, subscription_id){
      return new Promise(function(resolve) {
        stripe_js.subscriptions.del(
          subscription_id,
          function(err, confirmation) {
            if(err){
              console.error('['+bot.getTime('stamp')+'] [stripe.js] Error Canceling Subscription.', err.message);
              return resolve(null);
            } else{
              bot.sendEmbed(member, 'FF0000', 'Subscription Cancellation', '', config.discord.log_channel);
              bot.sendDM(member,'Subscription Cancellation', 'Your subscription has been cancelled due to leaving the Server.','FFFF00');
              console.log("["+bot.getTime("stamp")+"] [stripe.js] "+member.user.tag+"'s subscription has been cancelled due to leaving the Server.");
              return resolve(confirmation);
            }
        });
      });
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SESSION FUNCTIONS
//------------------------------------------------------------------------------
  sessions: {
//------------------------------------------------------------------------------
//  CHECKOUT
//------------------------------------------------------------------------------
    checkout: async function(req, res) {
      const mode = req.body.mode;
      const customerID = req.body.customerID;
      const priceID = req.body.priceID;
      var sessionbody = {
        mode: mode,
        customer: customerID,
        line_items: [
          {
            price: priceID,
            quantity: 1,
          },
        ],
        success_url: config.map_url,
        cancel_url: config.map_url,
      };
      if (config.stripe.taxes.active == true) {
        if (config.stripe.taxes.automatic == true) {
          sessionbody.automatic_tax = {enabled: true};
        } else if (config.stripe.taxes.dynamic == true) {
          sessionbody.line_items[0].dynamic_tax_rates = config.stripe.taxes.rate_ids;
        } else {
          sessionbody.line_items[0].tax_rates = config.stripe.taxes.rate_ids;
        }
      }
      if (config.stripe.addresses.billing == true) {
        sessionbody.billing_address_collection = "required";
        sessionbody.customer_update = {address: "auto"};
      }
      if (config.stripe.addresses.shipping != false) {
        sessionbody.shipping_address_collection = {allowed_countries: config.stripe.addresses.shipping};
        if (sessionbody.customer_update.address) {
          sessionbody.customer_update.shipping = "auto";
        } else {
          sessionbody.customer_update = {shipping: "auto"};
        }
      }
      try {
        const session = await stripe_js.checkout.sessions.create(sessionbody);
        return res.redirect(303, session.url);
      } catch (e) {
        res.status(400);
        return res.send({
          error: {
            message: e.message,
          }
        });
      }
    },
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL
//------------------------------------------------------------------------------
    portal: async function(req, res) {
      try {
        const customerID = req.body.customerID;
        const session = await stripe_js.billingPortal.sessions.create({
          customer: customerID,
          return_url: config.map_url,
        });
        return res.redirect(session.url);
      } catch (e) {
        res.status(400);
        return res.send({
          error: {
            message: e.message,
          }
        });
      }
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
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Refund webhook for '+member.user.tag+' ('+customer.id+').');
            bot.sendDM(member,'Payment Refunded! 🏧', 'Amount: **$'+webhook.data.object.amount_refunded/100+'**, Access Revoked, Update Payment Information if Continuing','0000FF');
            bot.removeDonor(customer.description.split(' - ')[1]);
            if(webhook.data.object.amount_refunded){
              return bot.sendEmbed(member, '0000FF', 'Payment Refunded! 🏧', 'Amount: **$'+webhook.data.object.amount_refunded/100+'**', config.discord.log_channel);
            } else{ return; }
        } return;
//------------------------------------------------------------------------------
//   CHARGE SUCCESSFUL WEBHOOK
//------------------------------------------------------------------------------
      case 'charge.succeeded':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Successful Charge webhook for '+member.user.tag+' ('+customer.id+').');
            bot.sendDM(member,'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**','00FF00');
            bot.assignDonor(customer.description.split(' - ')[1]);
            bot.sendEmbed(member, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**', config.discord.log_channel);
            return database.runQuery('UPDATE stripe_users SET stripe_id = ?, plan_id = ? WHERE user_id = ?', [customer.id, customer.subscriptions.data[0].plan.id, customer.description.split(' - ')[1]]);
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION DELETED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.deleted':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        if(!customer.description){ console.error("[No Customer Description]",customer); }
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+customer.description.split(' - ')[0]+' ('+webhook.data.object.customer+').');
            bot.sendDM(member,'Subscription Record Deleted! ⚰', 'Access Revoked, Please Start Over if Continuing','FF0000');
            bot.removeDonor(customer.description.split(' - ')[1]);
            bot.sendEmbed(member, 'FF0000', 'Subscription Record Deleted! ⚰', '', config.discord.log_channel);
            return database.runQuery('UPDATE stripe_users SET plan_id = NULL WHERE user_id = ?', [customer.description.split(' - ')[1]]);
        } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION CREATED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.created':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        console.log(customer.description);
        console.log(customer.id);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Created Subscription Webhook - ERROR - ('+customer.id+') Not User.');
          case !member: return console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Created Subscription Webhook - ERROR - ('+customer.id+') Not Member.');
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Created Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.object.status == "active"){
              bot.assignDonor(customer.description.split(' - ')[1]);
              if(config.donor_welcome == true){
                bot.channels.cache.get(config.config.discord.donor_welcome_channel)
                  .send(config.donor_welcome_content.replace('%usertag%','<@'+member.id+'>'))
                  .catch(console.error);
              }
              bot.sendEmbed(member, '00FF00', 'New Subscription Sucessfully Created! 📋', '', config.discord.log_channel);
            } else {
              bot.sendEmbed(member, 'FFFF00', 'New Subscription Partially Created ⚠️', '', config.discord.log_channel);
              return database.runQuery('UPDATE stripe_users SET plan_id = ? WHERE user_id = ?', [customer.subscriptions.data[0].plan.id, member.user.id]);
            } return;
          } return;
//------------------------------------------------------------------------------
//   SUBSCRIPTION UPDATED WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.subscription.updated':
        customer = await stripe.customer.fetch(webhook.data.object.customer);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Updated Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.object.status == "active" && webhook.data.previous_attributes.status == "incomplete"){
              bot.assignDonor(customer.description.split(' - ')[1]);
              if(config.donor_welcome == true){
                bot.channels.cache.get(config.config.discord.donor_welcome_channel)
                  .send(config.donor_welcome_content.replace('%usertag%','<@'+member.id+'>'))
                  .catch(console.error);
              }
              bot.sendEmbed(member, '00FF00', 'Subscription Sucessfully Updated! 📋', '', config.discord.log_channel);
              return database.runQuery('UPDATE stripe_users SET plan_id = ? WHERE user_id = ?', [customer.subscriptions.data[0].plan.id, member.user.id]);
            } else { return;
            } return;
          } return;
//------------------------------------------------------------------------------
//   CUSTOMER CARD UPDATE WEBHOOK
//------------------------------------------------------------------------------
      case 'customer.updated':
        customer = await stripe.customer.fetch(webhook.data.object.id);
        user = await database.fetchStripeUser(customer.description.split(' - ')[1], customer.id);
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
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
                  bot.sendEmbed(member, 'FF0000', 'Customer Card Update Incomplete (Initial Setup/Refunded) ✏', '', config.discord.log_channel);
                  return;
                } else if(retry == 'PAID'){
                  bot.assignDonor(customer.description.split(' - ')[1]);
                  bot.sendDM(member,'Retry Success! ✔', 'Your card update resulted in successful payment. You should now have access!','00FF00');
                  console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') a successful payment confirmation.');
                  bot.sendEmbed(member, '00FF00', 'Customer Card Update Complete (Initial Setup/Refunded) ✏', '', config.discord.log_channel);
                  return;
                }
              } else {
                bot.sendDM(member,'Card Information Updated! ✔', 'Your card information for '+config.map_name+' has been successfully updated!','00FF00');
                console.error('['+bot.getTime('stamp')+'] [stripe.js] Sent '+member.user.tag+' ('+customer.id+') an update notification.');
                bot.sendEmbed(member, '00FF00', 'Customer Card Updated ✏', '', config.discord.log_channel);
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
        member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(customer.description.split(' - ')[1]);
        switch(true){
          case !user: return;
          case !member: return;
          case user.plan_id != config.stripe.plan_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Payment Failed webhook for '+member.user.tag+' ('+customer.id+').');
            bot.removeDonor(customer.description.split(' - ')[1]);
            if(webhook.data.object.billing_reason == 'subscription_create') {
              bot.sendEmbed(member, 'FF0000', 'Subscription Creation Payment Failed! ⛔', 'Only Attempt', config.discord.log_channel);
              return;
            }
            bot.sendEmbed(member, 'FF0000', 'Payment Failed! ⛔', 'Only Attempt', config.discord.log_channel);
            return bot.sendDM(member,'Subscription Payment Failed! ⛔', 'Uh Oh! Your Payment failed to '+config.map_name+'. Please visit '+config.map_url+' to Update your payment information.','FF0000');
		} return;
    } return;
  }
};
// EXPORT OBJECT
module.exports = stripe;
// SCRIPT REQUIREMENTS
database = require(__dirname + '/database.js');
bot = require(__dirname + '/bot.js');
