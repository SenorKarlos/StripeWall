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
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Created.');
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
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Updated.');
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
              console.log('['+bot.getTime('stamp')+'] [stripe.js] Stripe Customer '+customer.name+' ('+customer.description+' | '+customer.id+') has been Deleted.');
              return resolve(confirmation);
            }
          }
        );
      });
    },
//------------------------------------------------------------------------------
//  MAINTENANCE ROUTINES (STRIPE)
//------------------------------------------------------------------------------
    list: async function() {
      console.info("["+bot.getTime("stamp")+"] [stripe.js] Starting Stripe Customer Sync.");
      let list = [];
      for await (const customer of stripe_js.customers.list({limit: 100, expand: ['data.subscriptions']})) {
        list.push(customer);
      } return stripe.customer.parse(list);
    },
    parse: async function(parse) {
      console.info("["+bot.getTime('stamp')+"] [stripe.js] Parsing "+parse.length+" users.")
      let unix = moment().unix();
      parse.forEach((customer,index) => {
        let indexcounter = index + 1;
        setTimeout(function() {
          database.db.query('SELECT * FROM stripe_users WHERE user_id = ?', [customer.description], async function (err, record, fields) {
            if (err) { return console.error('['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+')', err.message); }
            let stripe_updated = false;
            let db_updated = false;
            if (customer.name != record[0].user_name || customer.email != record[0].email) {
              await stripe.customer.update(customer.id, record[0].email, record[0].user_name);
              stripe_updated = true;
            }
            if (customer.subscriptions.data[0]) {
              for (let x = 0; x < customer.subscriptions.data.length; x++) {
                for (let i = 0; i < config.stripe.price_ids.length; i++) {
                  if (customer.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
                    if (record[0]) {
                      if (customer.id != record[0].stripe_id || customer.subscriptions.data[x].items.data[0].price.id != record[0].price_id && customer.subscriptions.data[x].status == 'active') {
                        database.runQuery('UPDATE stripe_users SET stripe_id = ?, price_id = ? WHERE user_id = ?', [customer.id, customer.subscriptions.data[x].items.data[0].price.id, customer.description]);
                        db_updated = true;
                      }
                    } else { // end if in database
                      database.runQuery('INSERT INTO stripe_users (user_name, user_id, stripe_id, price_id, email) VALUES (?, ?, ?, ?, ?)', [customer.name, customer.description, customer.id, customer.subscriptions.data[x].items.data[0].price.id, customer.email]);
                      console.info('['+bot.getTime('stamp')+'] [stripe.js]  ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+') Inserted User into Database.');
                      if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                    } // end not in database
                  } // dead end of customer price vs config price
                } // dead end for every price in config
              } // dead end for each sub in customer array (usually 1)
            } else { //end customer has sub
              if (record[0]) {
                if (customer.id != record[0].stripe_id) {
                  database.runQuery('UPDATE stripe_users SET stripe_id = ? WHERE user_id = ?', [customer.id, customer.description]);
                  db_updated = true;
                } //check and fix ID
                if (record[0].price_id != null) {
                  for (let i = 0; i < config.stripe.price_ids.length; i++) {
                    if (record[0].price_id == config.stripe.price_ids[i].id) {
                      if (config.stripe.price_ids[i].mode == "subscription" || record[0].temp_plan_expiration < unix) {
                        database.runQuery('UPDATE stripe_users SET price_id = NULL, temp_plan_expiration = NULL WHERE user_id = ?', [customer.description]);
                        db_updated = true;
                      /*} else {*/
                        /* Maybe something about storing, pulling & checking invoice details & expiry calc for temp plans , but probably too much and not needed */
                      } //end if mode is sub or temp plan expired
                    } // end if record price matches config price
                  } // dead end for each price in config
                } // end if db price not null
              } else { // end of in DB
                database.runQuery('INSERT INTO stripe_users (user_name, user_id, stripe_id, email) VALUES (?, ?, ?, ?)',
                  [customer.name, customer.description, customer.id, customer.email]);
                console.info('['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+') Inserted User into Database. This user may require Manual Temp Plan updating');
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
              } //end not in db
            } // end of customer has no sub data
            let log_start = '['+bot.getTime('stamp')+'] [stripe.js] ('+indexcounter+' of '+parse.length+') '+customer.name+' ('+customer.description+' | '+customer.id+')';
            let log_db_up = ' Updated Stripe IDs';
            let log_db_ver = ' Verified Stripe IDs';
            let log_str_up = ' Updated Stripe Info';
            let log_str_ver = ' Verified Stripe Info';
            switch (true) {
              case (stripe_updated && db_updated):
                console.info(log_start+log_db_up+' &'+log_str_up);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              case (stripe_updated && !db_updated):
                console.info(log_start+log_db_ver+' &'+log_str_up);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              case (db_updated && !stripe_updated):
                console.info(log_start+log_db_up+' &'+log_str_ver);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
                break;
              default:
                console.info(log_start+log_db_ver+' &'+log_str_ver);
                if (indexcounter === parse.length) { return stripe.customer.doneParse(); }
            } // end if updated or verified
          }); // dead end after database fetch
        }, 1000 * index);
      }); //end for each customer
    },
    doneParse: async function() {
      console.info("["+bot.getTime("stamp")+"] [stripe.js] Stripe Customer Sync Complete, proceeding to Database checks.");
      return database.checkDatabase();
    }
  },
//------------------------------------------------------------------------------
//  STRIPE SUBSCRIPTION FUNCTIONS
//------------------------------------------------------------------------------
  subscription: {
//------------------------------------------------------------------------------
//  CANCEL A SUSBCRIPTION
//------------------------------------------------------------------------------
    cancel: function(member, subscription_id){
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
console.log(req.body);
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
console.log(sessionbody);
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
  webhookParse: async function(data, eventType) {
    let customer = '', user = ''; member = '';
    switch(eventType){
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Refund webhook for '+member.user.tag+' ('+customer.id+').');
            bot.sendDM(member,'Payment Refunded! 🏧', 'Amount: **$'+webhook.data.object.amount_refunded/100+'**, Access Revoked, Update Payment Information if Continuing','0000FF');
            bot.removeRole(customer.description.split(' - ')[1]);
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Successful Charge webhook for '+member.user.tag+' ('+customer.id+').');
            bot.sendDM(member,'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**','00FF00');
            bot.assignRole(customer.description.split(' - ')[1]);
            bot.sendEmbed(member, '00FF00', 'Payment Successful! 💰 ', 'Amount: **$'+parseFloat(webhook.data.object.amount/100).toFixed(2)+'**', config.discord.log_channel);
            return database.runQuery('UPDATE stripe_users SET stripe_id = ?, price_id = ? WHERE user_id = ?', [customer.id, customer.subscriptions.data[0].items.data[0].price.id, customer.description.split(' - ')[1]]);
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Deleted Subcscription webhook for '+customer.description.split(' - ')[0]+' ('+webhook.data.object.customer+').');
            bot.sendDM(member,'Subscription Record Deleted! ⚰', 'Access Revoked, Please Start Over if Continuing','FF0000');
            bot.removeRole(customer.description.split(' - ')[1]);
            bot.sendEmbed(member, 'FF0000', 'Subscription Record Deleted! ⚰', '', config.discord.log_channel);
            return database.runQuery('UPDATE stripe_users SET price_id = NULL WHERE user_id = ?', [customer.description.split(' - ')[1]]);
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Created Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.object.status == "active"){
              bot.assignRole(customer.description.split(' - ')[1]);
              bot.channels.cache.get(config.config.discord.welcome_channel)
                .send(config.welcome_content.replace('%usertag%','<@'+member.id+'>'))
                .catch(console.error);
              bot.sendEmbed(member, '00FF00', 'New Subscription Sucessfully Created! 📋', '', config.discord.log_channel);
            } else {
              bot.sendEmbed(member, 'FFFF00', 'New Subscription Partially Created ⚠️', '', config.discord.log_channel);
              return database.runQuery('UPDATE stripe_users SET price_id = ? WHERE user_id = ?', [customer.subscriptions.data[0].items.data[0].price.id, member.user.id]);
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Updated Subscription Webhook for '+member.user.tag+' ('+customer.id+').');
            if(webhook.data.object.status == "active" && webhook.data.previous_attributes.status == "incomplete"){
              bot.assignRole(customer.description.split(' - ')[1]);
              bot.channels.cache.get(config.config.discord.welcome_channel)
                .send(config.welcome_content.replace('%usertag%','<@'+member.id+'>'))
                .catch(console.error);
              bot.sendEmbed(member, '00FF00', 'Subscription Sucessfully Updated! 📋', '', config.discord.log_channel);
              return database.runQuery('UPDATE stripe_users SET price_id = ? WHERE user_id = ?', [customer.subscriptions.data[0].items.data[0].price.id, member.user.id]);
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
          case user.price_id != config.stripe.price_id: return;
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
                  bot.assignRole(customer.description.split(' - ')[1]);
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
          case user.price_id != config.stripe.price_id: return;
          default:
            console.log('['+bot.getTime('stamp')+'] [stripe.js] Received Payment Failed webhook for '+member.user.tag+' ('+customer.id+').');
            bot.removeRole(customer.description.split(' - ')[1]);
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
database = require(__dirname+'/database.js');
bot = require(__dirname+'/bot.js');
